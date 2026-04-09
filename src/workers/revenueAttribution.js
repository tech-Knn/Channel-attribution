/**
 * Revenue Attribution Worker
 *
 * Runs on the 'revenue-attribution' queue, triggered every 15 minutes
 * by a repeatable BullMQ job. Workflow:
 *
 *   1. Pull revenue data from AFS Reporting API (30-min overlapping window)
 *   2. For each channel with revenue → look up active assignment
 *   3. Upsert revenue_events in PostgreSQL (deduped on channel_id + period_start)
 *   4. Flag unattributed / orphan revenue
 *   5. Refresh materialized views
 *   6. Send Slack alert for orphan revenue
 */

'use strict';

const { Worker } = require('bullmq');
const config = require('../config');
const { pool } = require('../db/pool');
const queries = require('../db/queries');
const { getChannelAssignment } = require('../redis/stateStore');
const { fetchRevenueData } = require('./afsClient');
const { sendAlert } = require('./slackNotifier');

const QUEUE_NAME = 'revenue-attribution';

// Pull window: 30 minutes back from now (overlapping with previous pull for safety)
const PULL_WINDOW_MS = 30 * 60 * 1000;

/**
 * Process a revenue attribution job.
 *
 * @param {import('bullmq').Job} job
 */
async function processJob(job) {
  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - PULL_WINDOW_MS);

  console.log(
    `[revenueAttribution] Pulling revenue data: ` +
    `${startTime.toISOString()} → ${endTime.toISOString()}`,
  );

  // Step 1: Fetch revenue data from AFS
  let revenueData;
  try {
    revenueData = await fetchRevenueData(
      config.afs.publisherId,
      config.afs.apiKey,
      startTime,
      endTime,
    );
  } catch (err) {
    console.error('[revenueAttribution] AFS API call failed:', err.message);
    await sendAlert(
      `AFS revenue pull failed: ${err.message}\n` +
      `Window: ${startTime.toISOString()} → ${endTime.toISOString()}`,
      'error',
    );
    throw err; // Let BullMQ retry
  }

  if (!revenueData || revenueData.length === 0) {
    console.log('[revenueAttribution] No revenue data returned — nothing to process');
    return { status: 'empty', channelsProcessed: 0 };
  }

  console.log(`[revenueAttribution] Received data for ${revenueData.length} channels`);

  // Step 2: Process each channel's revenue
  let attributed = 0;
  let unattributed = 0;
  const orphanChannels = [];

  for (const record of revenueData) {
    try {
      await processChannelRevenue(record, startTime, endTime);
      attributed++;
    } catch (err) {
      if (err.code === 'ORPHAN_REVENUE') {
        unattributed++;
        orphanChannels.push(record.channelId);
      } else if (err.code === 'CHANNEL_NOT_FOUND') {
        // Channel exists in AFS but not in our system — log and skip
        console.warn(
          `[revenueAttribution] Channel ${record.channelId} not found in DB — ` +
          `revenue $${record.revenue} untracked`,
        );
        unattributed++;
      } else {
        console.error(
          `[revenueAttribution] Error processing channel ${record.channelId}:`,
          err.message,
        );
      }
    }
  }

  // Step 3: Refresh materialized views
  try {
    await queries.refreshMaterializedViews();
    console.log('[revenueAttribution] Materialized views refreshed');
  } catch (err) {
    console.error('[revenueAttribution] Failed to refresh materialized views:', err.message);
    // Non-fatal — views will be stale but system keeps running
  }

  // Step 4: Alert on orphan revenue
  if (orphanChannels.length > 0) {
    await sendAlert(
      `Orphan revenue detected on ${orphanChannels.length} channel(s): ` +
      `${orphanChannels.join(', ')}.\n` +
      `These channels have revenue but no active assignment. Investigation needed.`,
      'warning',
    );
  }

  const summary = {
    status: 'completed',
    window: { start: startTime.toISOString(), end: endTime.toISOString() },
    channelsProcessed: revenueData.length,
    attributed,
    unattributed,
  };

  console.log('[revenueAttribution] ✓ Pull complete:', JSON.stringify(summary));
  return summary;
}

/**
 * Process revenue for a single channel.
 *
 * @param {Object} record — { channelId, impressions, clicks, revenue }
 * @param {Date} periodStart
 * @param {Date} periodEnd
 */
async function processChannelRevenue(record, periodStart, periodEnd) {
  const { channelId: externalChannelId, impressions, clicks, revenue } = record;

  // Look up the channel in our database by channel_id
  const { rows } = await pool.query(
    'SELECT * FROM channels WHERE channel_id = $1',
    [String(externalChannelId)],
  );
  const channel = rows[0];

  if (!channel) {
    const err = new Error(`Channel ${externalChannelId} not found in database`);
    err.code = 'CHANNEL_NOT_FOUND';
    throw err;
  }

  // Try to find active assignment — check Redis first, fall back to PostgreSQL
  let articleId = await getChannelAssignment(channel.id);
  let assignmentId = null;
  let isAttributed = true;

  if (articleId) {
    // Redis hit — also get the assignment ID from PostgreSQL
    const assignment = await queries.getActiveAssignmentByChannel(channel.id);
    assignmentId = assignment?.id || null;
    articleId = Number(articleId);
  } else {
    // No Redis state — check PostgreSQL directly
    const assignment = await queries.getActiveAssignmentByChannel(channel.id);
    if (assignment) {
      articleId = assignment.article_id;
      assignmentId = assignment.id;
    } else {
      // Orphan revenue — channel has revenue but no assignment
      isAttributed = false;
      const err = new Error(`Orphan revenue on channel ${channel.id} (${externalChannelId})`);
      err.code = 'ORPHAN_REVENUE';

      // Still write the revenue event (unattributed) before throwing
      await queries.upsertRevenueEvent({
        channelId: channel.id,
        articleId: null,
        assignmentId: null,
        impressions,
        clicks,
        revenue,
        periodStart,
        periodEnd,
        attributed: false,
      });

      console.warn(
        `[revenueAttribution] Orphan revenue: channel ${channel.id} ` +
        `(${externalChannelId}), $${revenue}`,
      );
      throw err;
    }
  }

  // Upsert the attributed revenue event
  await queries.upsertRevenueEvent({
    channelId: channel.id,
    articleId,
    assignmentId,
    impressions,
    clicks,
    revenue,
    periodStart,
    periodEnd,
    attributed: isAttributed,
  });

  console.log(
    `[revenueAttribution] Revenue recorded: channel ${channel.id} → ` +
    `article ${articleId}, $${revenue} (${impressions} imp, ${clicks} clicks)`,
  );
}

// ---------------------------------------------------------------------------
// Worker factory
// ---------------------------------------------------------------------------

/**
 * Create and start the revenue attribution worker.
 * @returns {import('bullmq').Worker}
 */
function createRevenueAttributionWorker() {
  const worker = new Worker(QUEUE_NAME, processJob, {
    connection: require('../redis/queues').connection,
    concurrency: 1, // One pull at a time — no overlap
  });

  worker.on('completed', (job, result) => {
    console.log(
      `[revenueAttribution] Job ${job.id} completed: ` +
      `${result?.attributed || 0} attributed, ${result?.unattributed || 0} unattributed`,
    );
  });

  worker.on('failed', (job, err) => {
    console.error(`[revenueAttribution] Job ${job?.id} failed:`, err.message);
  });

  worker.on('error', (err) => {
    console.error('[revenueAttribution] Worker error:', err.message);
  });

  console.log('[revenueAttribution] Worker started — listening on queue:', QUEUE_NAME);
  return worker;
}

module.exports = { createRevenueAttributionWorker, processJob };
