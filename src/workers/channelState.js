/**
 * Channel State Worker
 *
 * Listens on the 'channel-state' queue. Handles channel status transitions:
 *
 *   - idle:        Add to idle queue, check if waiting articles need assignment
 *   - active:      Channel is actively serving — no queue changes needed
 *   - disapproved: Skip idle queue, send Slack alert for manual review
 *
 * Job data shape:
 *   { channelId: number, newStatus: 'idle' | 'active' | 'disapproved' }
 */

'use strict';

const { Worker } = require('bullmq');
const config = require('../config');
const queries = require('../db/queries');
const { addToIdleQueue, removeFromIdleQueue, popWaitingArticle } = require('../redis/channelQueue');
const { removeChannelAssignment, removeArticleChannel } = require('../redis/stateStore');
const { queues } = require('../redis/queues');
const { sendAlert } = require('./slackNotifier');

const QUEUE_NAME = 'channel-state';

/**
 * Process a channel state change event.
 *
 * @param {import('bullmq').Job} job
 */
async function processJob(job) {
  const { channelId, newStatus } = job.data;

  if (!channelId || !newStatus) {
    throw new Error('Job missing required fields: channelId, newStatus');
  }

  console.log(`[channelState] Processing status change: channel ${channelId} → ${newStatus}`);

  // Verify channel exists
  const channel = await queries.getChannelById(channelId);
  if (!channel) {
    console.warn(`[channelState] Channel ${channelId} not found — skipping`);
    return { status: 'skipped', reason: 'channel_not_found' };
  }

  const oldStatus = channel.status;

  switch (newStatus) {
    case 'idle':
      return await handleIdle(channelId, oldStatus);

    case 'active':
      return await handleActive(channelId);

    case 'disapproved':
      return await handleDisapproved(channelId, oldStatus);

    default:
      console.warn(`[channelState] Unknown status "${newStatus}" for channel ${channelId}`);
      return { status: 'skipped', reason: 'unknown_status' };
  }
}

/**
 * Channel becomes idle — add to queue, try to assign a waiting article.
 */
async function handleIdle(channelId, oldStatus) {
  const now = new Date();

  if (oldStatus === 'assigned') {
    const active = await queries.getActiveAssignmentForChannel(channelId);
    if (active) {
      await queries.closeAssignment(active.id, 'completed');
      await removeChannelAssignment(channelId);
      await removeArticleChannel(active.article_id);
    }
  }

  // Update PostgreSQL
  await queries.updateChannelStatus(channelId, 'idle', {
    idleSince: now,
    assignedTo: null,
  });

  // Log the event
  await queries.logChannelEvent(channelId, 'idle', null, {
    previousStatus: oldStatus,
  });

  // Add to Redis idle queue
  await addToIdleQueue(channelId, now.getTime());
  console.log(`[channelState] Channel ${channelId} added to idle queue`);

  // Check if there's a waiting article that needs a channel
  const waitingArticleId = await popWaitingArticle();
  if (waitingArticleId) {
    console.log(
      `[channelState] Found waiting article ${waitingArticleId} — triggering assignment`,
    );
    // Dispatch an assignment job — the matching engine will pop this channel
    await queues.articleAssignment.add('assign-waiting', {
      articleId: Number(waitingArticleId),
    });
    return {
      status: 'idle_with_reassignment',
      channelId,
      waitingArticleId,
    };
  }

  return { status: 'idle', channelId };
}

/**
 * Channel is actively serving — just update status.
 */
async function handleActive(channelId) {
  await queries.updateChannelStatus(channelId, 'assigned', {});

  // Remove from idle queue if it was there (shouldn't be, but defensive)
  await removeFromIdleQueue(channelId);

  await queries.logChannelEvent(channelId, 'reactivated', null, null);

  console.log(`[channelState] Channel ${channelId} marked active`);
  return { status: 'active', channelId };
}

/**
 * Channel disapproved — remove from idle queue, alert Slack.
 */
async function handleDisapproved(channelId, oldStatus) {
  if (oldStatus === 'assigned') {
    const active = await queries.getActiveAssignmentForChannel(channelId);
    if (active) {
      await queries.closeAssignment(active.id, 'completed');
      await removeChannelAssignment(channelId);
      await removeArticleChannel(active.article_id);
      await queues.articleAssignment.add('reassign-after-disapproval', {
        articleId: Number(active.article_id),
      });
    }
  }

  // Remove from idle queue (if it was idle)
  await removeFromIdleQueue(channelId);

  // Update PostgreSQL
  await queries.updateChannelStatus(channelId, 'disapproved', {
    idleSince: null,
    assignedTo: null,
  });

  // Log the event
  await queries.logChannelEvent(channelId, 'disapproved', null, {
    previousStatus: oldStatus,
  });

  // Send Slack alert
  const channel = await queries.getChannelById(channelId);
  await sendAlert(
    `Channel ${channelId} (${channel?.external_id || 'unknown'}) has been disapproved.\n` +
    `Previous status: ${oldStatus}. Requires manual review.`,
    'warning',
  );

  console.log(`[channelState] Channel ${channelId} disapproved — Slack alert sent`);
  return { status: 'disapproved', channelId };
}

// ---------------------------------------------------------------------------
// Worker factory
// ---------------------------------------------------------------------------

/**
 * Create and start the channel state worker.
 * @returns {import('bullmq').Worker}
 */
function createChannelStateWorker() {
  const worker = new Worker(QUEUE_NAME, processJob, {
    connection: {
      url: config.redis.url,
      maxRetriesPerRequest: null,
    },
    concurrency: 1, // Sequential to avoid race conditions on state transitions
  });

  worker.on('completed', (job, result) => {
    console.log(`[channelState] Job ${job.id} completed:`, result?.status);
  });

  worker.on('failed', (job, err) => {
    console.error(`[channelState] Job ${job?.id} failed:`, err.message);
  });

  worker.on('error', (err) => {
    console.error('[channelState] Worker error:', err.message);
  });

  console.log('[channelState] Worker started — listening on queue:', QUEUE_NAME);
  return worker;
}

module.exports = { createChannelStateWorker, processJob };
