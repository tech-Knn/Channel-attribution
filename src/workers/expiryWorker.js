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

async function processJob(job) {
  console.log('[expiryWorker] Starting expiry check...');

  const zeroTrafficMinutes = config.expiry.zeroTrafficMinutes;

  let expirableArticles;
  try {
    expirableArticles = await queries.getZeroTrafficArticles(zeroTrafficMinutes);
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
      console.error(`[expiryWorker] Failed to expire article ${article.id}:`, err.message);
    }
  }

  const summary = { status: 'completed', expired, channelsFreed, reassigned, total: expirableArticles.length };

  console.log('[expiryWorker] Expiry check complete:', JSON.stringify(summary));

  if (expired >= 10) {
    await sendAlert(
      `Expiry worker reclaimed ${channelsFreed} channel(s) from ${expired} zero-traffic article(s). ` +
      `${reassigned} immediately reassigned to waiting articles.`,
      'info',
    );
  }

  return summary;
}

async function expireArticle(article) {
  const client = await pool.connect();
  let channelFreed = false;
  let reassigned = false;
  let freedChannelId = null;

  try {
    await client.query('BEGIN');

    await queries.updateArticleStatus(article.id, 'expired', {
      expiredAt: new Date(),
      expiryReason: 'zero_traffic',
    }, client);

    // Reset so the reactivation counter starts from zero after expiry
    await client.query(`UPDATE articles SET direct_pageviews = 0 WHERE id = $1`, [article.id]);

    const closedAssignment = await queries.closeAssignmentByArticle(article.id, 'expired', client);

    if (closedAssignment) {
      freedChannelId = closedAssignment.channel_id;

      await queries.updateChannelStatus(freedChannelId, 'idle', { idleSince: new Date(), assignedTo: null }, client);

      await queries.logChannelEvent(freedChannelId, 'unassigned', article.id, JSON.stringify({
        reason: 'zero_traffic_expiry',
        assignmentId: closedAssignment.id,
        articlePublishedAt: article.published_at,
      }), client);

      channelFreed = true;
    }

    await client.query('COMMIT');

    if (freedChannelId) {
      await removeChannelAssignment(freedChannelId);
      await removeArticleChannel(article.id);

      const domain = article.domain || 'articlespectrum.com';
      await addToIdleQueue(freedChannelId, Date.now(), domain);

      console.log(`[expiryWorker] Article ${article.id} expired — channel ${freedChannelId} freed`);

      const waitingArticleId = await popWaitingArticle(domain);
      if (waitingArticleId) {
        await queues.articleAssignment.add('assign-after-expiry', { articleId: Number(waitingArticleId), domain }, {
          jobId: `assign-${waitingArticleId}`,
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
        });
        reassigned = true;
        console.log(`[expiryWorker] Waiting article ${waitingArticleId} dispatched for assignment`);
      }
    } else {
      console.log(`[expiryWorker] Article ${article.id} expired (no active assignment found)`);
    }

    return { channelFreed, reassigned };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

function createExpiryWorker() {
  const worker = new Worker(QUEUE_NAME, processJob, {
    connection: require('../redis/queues').connection,
    concurrency: 1,
  });

  worker.on('completed', (job, result) => {
    console.log(`[expiryWorker] Job ${job.id} completed: ${result?.expired || 0} expired, ${result?.channelsFreed || 0} channels freed`);
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
