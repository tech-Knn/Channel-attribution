/**
 * Revenue Attribution Worker
 *
 * Triggered every 15 minutes by a repeatable BullMQ job. For each channel
 * with revenue in the pull window:
 *
 *   1. Find every assignment whose lifetime overlapped the period.
 *   2. Pro-rata split the channel's revenue across overlapping assignments
 *      using pageview share as the weight (time-weighted fallback when no
 *      pageview data is available — e.g. assignments closed before
 *      pageviews_at_close was captured).
 *   3. Upsert ONE revenue_events row per (channel, assignment, period).
 *   4. If no assignments overlapped but a recent one closed within 24h,
 *      attribute as "late revenue" — AdSense's reporting delay means
 *      tail-end revenue often arrives after an article has expired.
 *   5. Otherwise record an orphan row (article_id NULL, attributed=false)
 *      and emit a Slack alert.
 *
 * This replaces the previous logic that always attributed the whole pull
 * to the channel's CURRENT assignment, regardless of who actually held
 * the channel during the revenue period.
 */

'use strict';

const { Worker } = require('bullmq');
const config = require('../config');
const { pool } = require('../db/pool');
const queries = require('../db/queries');
const { fetchRevenueData } = require('./afsClient');
const { sendAlert } = require('./slackNotifier');

const QUEUE_NAME = 'revenue-attribution';

// Pull window: 30 minutes back from now (overlapping with previous pull for safety)
const PULL_WINDOW_MS = 30 * 60 * 1000;

// AdSense reports impressions/clicks for up to 24-48h after they occur.
// If a channel earned money but went idle in the meantime, attribute the
// tail revenue to whichever assignment closed most recently within this
// window. Beyond it, record as orphan.
const LATE_ATTRIBUTION_WINDOW_MS = 24 * 60 * 60 * 1000;

async function processJob(job) {
  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - PULL_WINDOW_MS);

  console.log(
    `[revenueAttribution] Pulling revenue: ${startTime.toISOString()} → ${endTime.toISOString()}`,
  );

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
    throw err;
  }

  if (!revenueData || revenueData.length === 0) {
    console.log('[revenueAttribution] No revenue data — nothing to process');
    return { status: 'empty', channelsProcessed: 0 };
  }

  console.log(`[revenueAttribution] Received data for ${revenueData.length} channels`);

  let channelsAttributed = 0;
  let rowsWritten = 0;
  let lateAttributed = 0;
  const orphanChannels = [];

  for (const record of revenueData) {
    try {
      const outcome = await processChannelRevenue(record, startTime, endTime);
      channelsAttributed++;
      rowsWritten += outcome.rows;
      if (outcome.late) lateAttributed++;
      if (outcome.orphan) orphanChannels.push(record.channelId);
    } catch (err) {
      if (err.code === 'CHANNEL_NOT_FOUND') {
        console.warn(
          `[revenueAttribution] Channel ${record.channelId} not in DB — ` +
          `$${record.revenue} untracked`,
        );
      } else {
        console.error(
          `[revenueAttribution] Error on channel ${record.channelId}:`,
          err.message,
        );
      }
    }
  }

  try {
    await queries.refreshMaterializedViews();
    console.log('[revenueAttribution] Materialized views refreshed');
  } catch (err) {
    console.error('[revenueAttribution] MV refresh failed:', err.message);
  }

  if (orphanChannels.length > 0) {
    await sendAlert(
      `Orphan revenue on ${orphanChannels.length} channel(s): ` +
      `${orphanChannels.join(', ')}.\n` +
      `These channels earned revenue with no assignment overlap and no recent close.`,
      'warning',
    );
  }

  const summary = {
    status: 'completed',
    window: { start: startTime.toISOString(), end: endTime.toISOString() },
    channelsProcessed: revenueData.length,
    channelsAttributed,
    rowsWritten,
    lateAttributed,
    orphan: orphanChannels.length,
  };
  console.log('[revenueAttribution] Pull complete:', JSON.stringify(summary));
  return summary;
}

/**
 * Process one channel's revenue for the pull window.
 *
 * @param {{channelId: string, impressions: number, clicks: number, revenue: number}} record
 * @param {Date} periodStart
 * @param {Date} periodEnd
 * @returns {Promise<{rows: number, late: boolean, orphan: boolean}>}
 */
async function processChannelRevenue(record, periodStart, periodEnd) {
  const { channelId: externalChannelId, impressions, clicks, revenue } = record;

  const { rows } = await pool.query(
    'SELECT * FROM channels WHERE channel_id = $1',
    [String(externalChannelId)],
  );
  const channel = rows[0];

  if (!channel) {
    const err = new Error(`Channel ${externalChannelId} not in DB`);
    err.code = 'CHANNEL_NOT_FOUND';
    throw err;
  }

  const overlapping = await queries.getAssignmentsOverlapping(channel.id, periodStart, periodEnd);

  // ── Path A: at least one assignment overlapped the period ────────────
  if (overlapping.length > 0) {
    const splits = splitRevenue({ impressions, clicks, revenue }, overlapping, periodStart, periodEnd);
    for (const s of splits) {
      await queries.upsertRevenueEvent({
        channelId:      channel.id,
        articleId:      s.articleId,
        assignmentId:   s.assignmentId,
        impressions:    s.impressions,
        clicks:         s.clicks,
        revenue:        s.revenue,
        periodStart,
        periodEnd,
        attributed:     true,
        attributedLate: false,
      });
    }
    console.log(
      `[revenueAttribution] channel ${externalChannelId}: split $${revenue} across ` +
      `${splits.length} assignment(s) (${splits.map((s) => '$' + s.revenue.toFixed(2)).join(', ')})`,
    );
    return { rows: splits.length, late: false, orphan: false };
  }

  // ── Path B: no overlap, but a recent close within 24h → late revenue ─
  const recentlyClosed = await queries.getRecentlyClosedAssignment(
    channel.id, periodEnd, LATE_ATTRIBUTION_WINDOW_MS,
  );
  if (recentlyClosed) {
    await queries.upsertRevenueEvent({
      channelId:      channel.id,
      articleId:      recentlyClosed.article_id,
      assignmentId:   recentlyClosed.id,
      impressions, clicks, revenue,
      periodStart, periodEnd,
      attributed:     true,
      attributedLate: true,
    });
    console.log(
      `[revenueAttribution] channel ${externalChannelId}: late revenue $${revenue} → ` +
      `assignment ${recentlyClosed.id} (${recentlyClosed.article_ref}, closed ${recentlyClosed.unassigned_at})`,
    );
    return { rows: 1, late: true, orphan: false };
  }

  // ── Path C: nothing matches → orphan ─────────────────────────────────
  await queries.upsertRevenueEvent({
    channelId:      channel.id,
    articleId:      null,
    assignmentId:   null,
    impressions, clicks, revenue,
    periodStart, periodEnd,
    attributed:     false,
    attributedLate: false,
  });
  console.warn(
    `[revenueAttribution] channel ${externalChannelId}: orphan $${revenue} ` +
    `(no overlap, no recent close)`,
  );
  return { rows: 1, late: false, orphan: true };
}

/**
 * Pro-rata split a channel's (revenue, impressions, clicks) across the
 * assignments that overlapped its period.
 *
 * Weighting strategy:
 *   1. Prefer pageview share — use pageviews_at_close for closed assignments,
 *      article.direct_pageviews for the currently-active one.
 *   2. If every assignment has 0/NULL pageviews, fall back to time-weighted
 *      split (hours of overlap with the period).
 *   3. If even time-overlap is zero (edge case), give all to the first one.
 *
 * Returns an array of { assignmentId, articleId, impressions, clicks, revenue }.
 * Splits are rounded with the last entry receiving the rounding remainder
 * so the totals still equal the input exactly.
 */
function splitRevenue({ impressions, clicks, revenue }, overlapping, periodStart, periodEnd) {
  // ── compute weights ──────────────────────────────────────────────────
  const pageviewWeights = overlapping.map((asn) => {
    if (asn.status === 'active' || !asn.unassigned_at) {
      return Number(asn.article_pageviews_now) || 0;
    }
    return Number(asn.pageviews_at_close) || 0;
  });

  let weights = pageviewWeights;
  const pageviewSum = pageviewWeights.reduce((a, b) => a + b, 0);

  if (pageviewSum <= 0) {
    // Fallback: time-weighted by hours of overlap with the period.
    weights = overlapping.map((asn) => overlapMs(asn, periodStart, periodEnd));
  }

  let weightSum = weights.reduce((a, b) => a + b, 0);
  if (weightSum <= 0) {
    weights = overlapping.map((_, i) => (i === 0 ? 1 : 0));
    weightSum = 1;
  }

  // ── apply weights ────────────────────────────────────────────────────
  const splits = overlapping.map((asn, i) => {
    const share = weights[i] / weightSum;
    return {
      assignmentId: asn.id,
      articleId:    asn.article_id,
      impressions:  Math.floor(impressions * share),
      clicks:       Math.floor(clicks      * share),
      revenue:      Number((revenue        * share).toFixed(4)),
    };
  });

  // Distribute rounding remainder to the largest-weight assignment so
  // SUM(splits.revenue) === revenue exactly.
  const sumImp = splits.reduce((a, s) => a + s.impressions, 0);
  const sumClk = splits.reduce((a, s) => a + s.clicks, 0);
  const sumRev = splits.reduce((a, s) => a + s.revenue, 0);
  let biggestIdx = 0;
  for (let i = 1; i < weights.length; i++) {
    if (weights[i] > weights[biggestIdx]) biggestIdx = i;
  }
  splits[biggestIdx].impressions += (impressions - sumImp);
  splits[biggestIdx].clicks      += (clicks      - sumClk);
  splits[biggestIdx].revenue     = Number((splits[biggestIdx].revenue + (revenue - sumRev)).toFixed(4));

  return splits;
}

function overlapMs(asn, periodStart, periodEnd) {
  const a = new Date(asn.assigned_at).getTime();
  const b = asn.unassigned_at ? new Date(asn.unassigned_at).getTime() : Date.now();
  const s = new Date(periodStart).getTime();
  const e = new Date(periodEnd).getTime();
  return Math.max(0, Math.min(b, e) - Math.max(a, s));
}

// ---------------------------------------------------------------------------
// Worker factory
// ---------------------------------------------------------------------------

function createRevenueAttributionWorker() {
  const worker = new Worker(QUEUE_NAME, processJob, {
    connection: require('../redis/queues').connection,
    concurrency: 1,
  });

  worker.on('completed', (job, result) => {
    console.log(
      `[revenueAttribution] Job ${job.id} completed — ` +
      `${result?.channelsAttributed || 0} channels, ${result?.rowsWritten || 0} rows`,
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

module.exports = { createRevenueAttributionWorker, processJob, splitRevenue };
