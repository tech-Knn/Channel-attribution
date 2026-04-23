'use strict';

const { Worker } = require('bullmq');
const { pool } = require('../db/pool');
const queries = require('../db/queries');
const { queues } = require('../redis/queues');
const { getHighTrafficPages } = require('./ga4Traffic');
const { sendAlert } = require('./slackNotifier');
const config = require('../config');

const QUEUE_NAME = 'article-reactivation';

async function processJob() {
  // One GA4 API call — returns Map<pagePath, activeUsers> for all pages >= threshold
  const { isDisabled } = require('./ga4Client');
  if (isDisabled()) {
    console.warn('[gaMonitor] GA4 disabled — skipping cycle');
    return { reactivated: 0, trafficUpdated: 0 };
  }

  // Fetch all pages with ANY traffic (threshold=1) for the heartbeat.
  // Reactivation uses a higher threshold filtered from the same result.
  let allTrafficPages;
  try {
    allTrafficPages = await getHighTrafficPages(1);
  } catch (err) {
    // Never throw — a GA4 error should not crash the job or cause retries
    console.error('[gaMonitor] GA4 API error (skipping cycle):', err.message);
    return { reactivated: 0, trafficUpdated: 0 };
  }

  if (allTrafficPages.size === 0) {
    console.log('[gaMonitor] no pages with traffic this cycle');
    return { reactivated: 0, trafficUpdated: 0 };
  }

  // Pages above the reactivation threshold (subset of allTrafficPages)
  const highTrafficPages = new Map(
    [...allTrafficPages].filter(([, users]) => users >= config.tracking.pageViewThreshold),
  );

  const [expiredArticles, activeArticles] = await Promise.all([
    queries.getExpiredArticlesForReactivation(),
    queries.getActiveArticlesWithUrl(),
  ]);

  let reactivated = 0;
  let trafficUpdated = 0;

  // Reactivation — expired articles that now have traffic above threshold
  for (const article of expiredArticles) {
    const pagePath = safePathname(article.url);
    if (!pagePath) continue;

    const activeUsers = highTrafficPages.get(pagePath);
    if (!activeUsers) continue;

    try {
      await handleReactivation(article, activeUsers);
      reactivated++;
    } catch (err) {
      console.error(`[gaMonitor] reactivation failed — article ${article.id}:`, err.message);
    }
  }

  // Traffic heartbeat — update last_traffic_at for ALL active/assigned articles
  // with any traffic (threshold=1), so the expiry worker doesn't expire them
  const pathsToUpdate = [];
  for (const article of activeArticles) {
    const pagePath = safePathname(article.url);
    if (pagePath && allTrafficPages.has(pagePath)) {
      pathsToUpdate.push(article.id);
    }
  }

  if (pathsToUpdate.length > 0) {
    await Promise.all(pathsToUpdate.map((id) => queries.updateArticleLastTrafficAt(id)));
    trafficUpdated = pathsToUpdate.length;
  }

  console.log(`[gaMonitor] cycle done — reactivated: ${reactivated}, traffic heartbeat: ${trafficUpdated}`);
  return { reactivated, trafficUpdated };
}

async function handleReactivation(article, activeUsers) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await queries.reactivateArticle(article.id, client);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  await queries.addArticleLifecycleEvent(article.id, 'reactivated', 'ga4', activeUsers);
  await queries.addChannelLog(null, 'reactivated', article.id, { triggeredBy: 'ga4', activeUsers });

  await queues.articleAssignment.add('reactivate-article', {
    articleId:  article.id,
    externalId: article.article_id,
    domain:     article.domain || 'articlespectrum.com',
  }, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
  });

  await sendAlert(
    `GA4 reactivation triggered.\n` +
    `Article: ${article.article_id} (id: ${article.id})\n` +
    `URL: ${article.url}\n` +
    `Active users (last 24hr): ${activeUsers} — threshold: ${config.tracking.pageViewThreshold}`,
    'info',
  );

  console.log(`[gaMonitor] article ${article.id} reactivated — ${activeUsers} active users`);
}

function safePathname(url) {
  try {
    return new URL(url).pathname;
  } catch {
    return null;
  }
}

function createGaMonitorWorker() {
  const worker = new Worker(QUEUE_NAME, processJob, {
    connection: require('../redis/queues').connection,
    concurrency: 1,
  });

  worker.on('completed', (job, result) => {
    console.log(`[gaMonitor] job ${job.id} done:`, result);
  });

  worker.on('failed', (job, err) => {
    console.error(`[gaMonitor] job ${job?.id} failed:`, err.message);
  });

  worker.on('error', (err) => {
    console.error('[gaMonitor] worker error:', err.message);
  });

  return worker;
}

module.exports = { createGaMonitorWorker, processJob };
