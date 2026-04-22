/**
 * Matching Engine Worker
 *
 * Listens on the 'article-assignment' queue. When a new article needs a
 * channel, this worker:
 *
 *   1. Pops the longest-idle channel from Redis (ZPOPMIN on ca:idle_channels)
 *   2. If found → creates assignment in PostgreSQL, updates Redis state, logs
 *   3. If not found → adds article to the waiting queue for later assignment
 *
 * Job data shape:
 *   { articleId: number }
 */

'use strict';

const { Worker } = require('bullmq');
const config = require('../config');
const { pool } = require('../db/pool');
const queries = require('../db/queries');
const { popOldestIdle, addToWaitingQueue } = require('../redis/channelQueue');
const { setChannelAssignment, setArticleChannel } = require('../redis/stateStore');

const QUEUE_NAME = 'article-assignment';

/**
 * Process a single article-assignment job.
 *
 * @param {import('bullmq').Job} job
 */
async function processJob(job) {
  const { articleId, domain = 'articlespectrum.com' } = job.data;

  if (!articleId) {
    throw new Error('Job missing required field: articleId');
  }

  console.log(`[matchingEngine] Processing assignment for article ${articleId} (domain: ${domain})`);

  // Verify article exists and is in a valid state
  const article = await queries.getArticleById(articleId);
  if (!article) {
    console.warn(`[matchingEngine] Article ${articleId} not found — skipping`);
    return { status: 'skipped', reason: 'article_not_found' };
  }

  if (!['pending', 'assigned'].includes(article.status)) {
    console.warn(`[matchingEngine] Article ${articleId} has status "${article.status}" — skipping`);
    return { status: 'skipped', reason: 'invalid_article_status' };
  }

  // Pop the longest-idle channel from the domain-specific queue
  const idle = await popOldestIdle(domain);

  if (!idle) {
    // No idle channel available — park the article in the domain waiting queue
    await addToWaitingQueue(articleId, domain);
    console.log(`[matchingEngine] No idle channels for ${domain} — article ${articleId} added to waiting queue`);
    return { status: 'queued', articleId };
  }

  const { channelId } = idle;
  console.log(`[matchingEngine] Assigning channel ${channelId} to article ${articleId}`);

  // Use a transaction to keep PostgreSQL consistent
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Create the assignment record
    const assignment = await queries.createAssignment({ articleId, channelId }, client);

    // Update channel status → assigned
    await queries.updateChannelStatus(
      channelId,
      'assigned',
      { assignedTo: articleId, idleSince: null },
      client,
    );

    // Update article status → assigned and reset traffic clock
    await queries.updateArticleStatus(articleId, 'assigned', { lastTrafficAt: new Date() }, client);

    // Log the event
    await queries.logChannelEvent(
      channelId,
      'assigned',
      articleId,
      JSON.stringify({
        assignmentId: assignment.id,
        idleDurationMs: Date.now() - idle.idleSince,
      }),
      client,
    );

    await client.query('COMMIT');

    // Update Redis state (outside transaction — Redis ops are idempotent)
    await setChannelAssignment(channelId, articleId);
    await setArticleChannel(articleId, channelId);

    console.log(
      `[matchingEngine] ✓ Assignment complete: channel ${channelId} → article ${articleId} ` +
      `(assignment #${assignment.id})`,
    );

    return {
      status: 'assigned',
      assignmentId: assignment.id,
      channelId,
      articleId,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`[matchingEngine] Assignment failed for article ${articleId}:`, err.message);

    // FK constraint means the channel doesn't exist in DB (ghost in Redis).
    // Discard it and park the article in the waiting queue so it gets picked up
    // when a real idle channel becomes available.
    if (err.message.includes('foreign key constraint')) {
      console.warn(`[matchingEngine] Channel ${channelId} is a ghost (not in DB) — discarded from idle queue`);
      await addToWaitingQueue(articleId, domain);
      console.log(`[matchingEngine] Article ${articleId} moved to waiting queue after ghost channel discard`);
      return { status: 'queued', reason: 'ghost_channel_discarded', articleId };
    }

    // For other errors, put the channel back so it can be retried
    const { addToIdleQueue } = require('../redis/channelQueue');
    await addToIdleQueue(channelId, idle.idleSince, domain);
    console.log(`[matchingEngine] Channel ${channelId} returned to idle queue after failure`);

    throw err; // Let BullMQ retry
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Worker factory
// ---------------------------------------------------------------------------

/**
 * Create and start the matching engine worker.
 * @returns {import('bullmq').Worker}
 */
function createMatchingEngineWorker() {
  const worker = new Worker(QUEUE_NAME, processJob, {
    connection: require('../redis/queues').connection,
    concurrency: 1, // Sequential processing to avoid race conditions on channel assignment
    limiter: {
      max: 100,
      duration: 1000, // Max 100 jobs/sec — safety valve
    },
  });

  worker.on('completed', (job, result) => {
    console.log(`[matchingEngine] Job ${job.id} completed:`, result?.status);
  });

  worker.on('failed', (job, err) => {
    console.error(`[matchingEngine] Job ${job?.id} failed:`, err.message);
  });

  worker.on('error', (err) => {
    console.error('[matchingEngine] Worker error:', err.message);
  });

  console.log('[matchingEngine] Worker started — listening on queue:', QUEUE_NAME);
  return worker;
}

module.exports = { createMatchingEngineWorker, processJob };
