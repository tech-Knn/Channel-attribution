/**
 * Expiry Worker
 *
 * Runs on the 'article-expiry' queue, triggered every hour by a repeatable
 * BullMQ job. Identifies articles published 72–96 hours ago with zero
 * revenue and reclaims their channels.
 *
 * Workflow per expired article:
 *   1. Mark article as expired (status='expired', reason='zero_traffic')
 *   2. Close the active assignment
 *   3. Free the channel back to the idle queue
 *   4. If waiting articles exist → trigger immediate assignment
 */

'use strict';

const { Worker } = require('bullmq');
const config = require('../config');
const { pool } = require('../db/pool');
const queries = require('../db/queries');
const { addToIdleQueue, popWaitingArticle } = require('../redis/channelQueue');
const { removeChannelAssignment, removeArticleChannel } = require('../redis/stateStore');
const { queues } = require('../redis/queues');
const { sendAlert } = require('./slackNotifier');

const QUEUE_NAME = 'article-expiry';

/**
 * Process the expiry check job.
 *
 * @param {import('bullmq').Job} job
 */
async function processJob(job) {
  console.log('[expiryWorker] Starting expiry check...');

  const zeroTrafficMinutes     = config.expiry.zeroTrafficMinutes;
  const trafficedExpiryMinutes = config.expiry.trafficedExpiryMinutes;

  let expirableArticles;
  try {
    expirableArticles = await queries.getZeroTrafficArticles(zeroTrafficMinutes, trafficedExpiryMinutes);
  } catch (err) {
    console.error('[expiryWorker] Failed to query expirable articles:', err.message);
    throw err;
  }

  if (expirableArticles.length === 0) {
    console.log('[expiryWorker] No articles eligible for expiry');
    return { status: 'completed', expired: 0, channelsFreed: 0 };
  }

  console.log(`[expiryWorker] Found ${expirableArticles.length} article(s) eligible for expiry`);

  let expired = 0;
  let channelsFreed = 0;
  let reassigned = 0;

  for (const article of expirableArticles) {
    try {
      const result = await expireArticle(article);
      expired++;
      if (result.channelFreed) channelsFreed++;
      if (result.reassigned) reassigned++;
    } catch (err) {
      console.error(
        `[expiryWorker] Failed to expire article ${article.id}:`,
        err.message,
      );
      // Continue with other articles — don't let one failure block the rest
    }
  }

  const summary = {
    status: 'completed',
    expired,
    channelsFreed,
    reassigned,
    total: expirableArticles.length,
  };

  console.log('[expiryWorker] ✓ Expiry check complete:', JSON.stringify(summary));

  // Alert if we expired a significant number of articles
  if (expired >= 10) {
    await sendAlert(
      `Expiry worker reclaimed ${channelsFreed} channel(s) from ${expired} zero-traffic article(s). ` +
      `${reassigned} immediately reassigned to waiting articles.`,
      'info',
    );
  }

  return summary;
}

/**
 * Expire a single article and free its channel.
 *
 * @param {Object} article — article row from PostgreSQL
 * @returns {Promise<{ channelFreed: boolean, reassigned: boolean }>}
 */
async function expireArticle(article) {
  const client = await pool.connect();
  let channelFreed = false;
  let reassigned = false;
  let freedChannelId = null;

  try {
    await client.query('BEGIN');

    // Mark article as expired and reset the reactivation counter
    await queries.updateArticleStatus(
      article.id,
      'expired',
      {
        expiredAt: new Date(),
        expiryReason: 'zero_traffic',
      },
      client,
    );
    await client.query(
      `UPDATE articles SET direct_pageviews = 0 WHERE id = $1`,
      [article.id],
    );

    // Close the active assignment and get the channel ID
    const closedAssignment = await queries.closeAssignmentByArticle(
      article.id,
      'expired',
      client,
    );

    if (closedAssignment) {
      freedChannelId = closedAssignment.channel_id;

      // Update channel status → idle
      await queries.updateChannelStatus(
        freedChannelId,
        'idle',
        { idleSince: new Date(), assignedTo: null },
        client,
      );

      // Log the channel event
      await queries.logChannelEvent(
        freedChannelId,
        'unassigned',
        article.id,
        JSON.stringify({
          reason: 'zero_traffic_expiry',
          assignmentId: closedAssignment.id,
          articlePublishedAt: article.published_at,
        }),
        client,
      );

      channelFreed = true;
    }

    await client.query('COMMIT');

    // Update Redis state (outside transaction)
    if (freedChannelId) {
      await removeChannelAssignment(freedChannelId);
      await removeArticleChannel(article.id);

      const domain = article.domain || 'articlespectrum.com';

      // Add channel back to idle queue (domain-scoped)
      await addToIdleQueue(freedChannelId, Date.now(), domain);

      console.log(
        `[expiryWorker] Article ${article.id} expired → channel ${freedChannelId} freed`,
      );

      // Check if a waiting article can use this channel immediately
      const waitingArticleId = await popWaitingArticle(domain);
      if (waitingArticleId) {
        await queues.articleAssignment.add('assign-after-expiry', {
          articleId: Number(waitingArticleId),
          domain,
        });
        reassigned = true;
        console.log(
          `[expiryWorker] Waiting article ${waitingArticleId} dispatched for assignment`,
        );
      }
    } else {
      console.log(
        `[expiryWorker] Article ${article.id} expired (no active assignment found)`,
      );
    }

    return { channelFreed, reassigned };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Worker factory
// ---------------------------------------------------------------------------

/**
 * Create and start the expiry worker.
 * @returns {import('bullmq').Worker}
 */
function createExpiryWorker() {
  const worker = new Worker(QUEUE_NAME, processJob, {
    connection: require('../redis/queues').connection,
    concurrency: 1, // One expiry check at a time
  });

  worker.on('completed', (job, result) => {
    console.log(
      `[expiryWorker] Job ${job.id} completed: ` +
      `${result?.expired || 0} expired, ${result?.channelsFreed || 0} channels freed`,
    );
  });

  worker.on('failed', (job, err) => {
    console.error(`[expiryWorker] Job ${job?.id} failed:`, err.message);
  });

  worker.on('error', (err) => {
    console.error('[expiryWorker] Worker error:', err.message);
  });

  console.log('[expiryWorker] Worker started — listening on queue:', QUEUE_NAME);
  return worker;
}

module.exports = { createExpiryWorker, processJob };
