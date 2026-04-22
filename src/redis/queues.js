/**
 * BullMQ Queue Definitions
 *
 * All queues share the same Redis connection. Workers consume from these
 * queues in separate files (src/workers/).
 */

'use strict';

const { Queue } = require('bullmq');
const config = require('../config');

const redisUrl = new URL(config.redis.url);
const isTLS = config.redis.url.startsWith('rediss://');

const connection = {
  host: redisUrl.hostname,
  port: parseInt(redisUrl.port, 10) || 6379,
  username: redisUrl.username || 'default',
  password: decodeURIComponent(redisUrl.password),
  ...(isTLS && { tls: { rejectUnauthorized: false } }),
};

const defaultOpts = { connection };

const queues = {
  articleAssignment: new Queue('article-assignment', defaultOpts),
  channelState:      new Queue('channel-state', defaultOpts),
  revenueAttribution: new Queue('revenue-attribution', defaultOpts),
  articleExpiry:     new Queue('article-expiry', defaultOpts),
  gaMonitor:         new Queue('article-reactivation', defaultOpts),
};

/**
 * Set up repeatable jobs (idempotent — safe to call on every startup).
 */
async function setupRepeatableJobs() {
  // Remove all existing repeatable jobs first to avoid duplicates across deploys
  for (const queue of Object.values(queues)) {
    const existing = await queue.getRepeatableJobs();
    for (const job of existing) {
      await queue.removeRepeatableByKey(job.key);
    }
  }

  // Revenue pull every 15 minutes
  await queues.revenueAttribution.add('pull-afs', {}, {
    repeat: { every: 15 * 60 * 1000 },
  });

  // Expiry check — interval controlled by EXPIRY_CHECK_INTERVAL_MS (default 1 min)
  await queues.articleExpiry.add('check-expiry', {}, {
    repeat: { every: config.expiry.checkIntervalMs },
  });

  // GA4 reactivation check — interval controlled by GA4_CHECK_INTERVAL_MS (default 1 min)
  await queues.gaMonitor.add('ga-reactivation-poll', {}, {
    repeat: { every: config.expiry.ga4CheckIntervalMs },
  });

  console.log('[queues] Repeatable jobs configured');
}

/**
 * Close all queues gracefully.
 */
async function closeAll() {
  await Promise.all(Object.values(queues).map((q) => q.close()));
  console.log('[queues] All queues closed');
}

module.exports = { queues, setupRepeatableJobs, closeAll, connection };
