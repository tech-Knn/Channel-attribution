/**
 * BullMQ Queue Definitions
 *
 * All queues share the same Redis connection. Workers consume from these
 * queues in separate files (src/workers/).
 */

'use strict';

const { Queue } = require('bullmq');
const config = require('../config');

const connection = {
  host: new URL(config.redis.url).hostname || 'localhost',
  port: parseInt(new URL(config.redis.url).port, 10) || 6379,
};

const defaultOpts = { connection };

const queues = {
  articleAssignment: new Queue('article-assignment', defaultOpts),
  channelState: new Queue('channel-state', defaultOpts),
  revenueAttribution: new Queue('revenue-attribution', defaultOpts),
  articleExpiry: new Queue('article-expiry', defaultOpts),
};

/**
 * Set up repeatable jobs (idempotent — safe to call on every startup).
 */
async function setupRepeatableJobs() {
  // Revenue pull every 15 minutes
  await queues.revenueAttribution.add('pull-afs', {}, {
    repeat: { every: 15 * 60 * 1000 },
  });

  // Expiry check every hour
  await queues.articleExpiry.add('check-expiry', {}, {
    repeat: { every: 60 * 60 * 1000 },
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
