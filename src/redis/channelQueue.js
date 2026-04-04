/**
 * Channel Queue — Redis sorted-set operations
 *
 * Two queues live here:
 *
 *  1. **Idle channel queue** (`ca:idle_channels`)
 *     Sorted set scored by the unix-ms timestamp when the channel became idle.
 *     ZPOPMIN gives us the *longest-idle* channel — fair round-robin by age.
 *
 *  2. **Waiting article queue** (`ca:waiting_articles`)
 *     Sorted set scored by insertion timestamp. When no idle channel is
 *     available, articles wait here until a channel frees up.
 */

'use strict';

const { client } = require('./client');

// ---------------------------------------------------------------------------
// Key names
// ---------------------------------------------------------------------------

const IDLE_KEY    = 'ca:idle_channels';
const WAITING_KEY = 'ca:waiting_articles';

// ═══════════════════════════════════════════════════════════════════════════
// Idle Channel Queue
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Add a channel to the idle queue.
 *
 * @param {string|number} channelId  — channel identifier
 * @param {number}        [idleSince=Date.now()] — unix-ms timestamp
 * @returns {Promise<number>} 1 if new, 0 if score updated
 */
async function addToIdleQueue(channelId, idleSince = Date.now()) {
  // NX is intentionally NOT used — if the channel is re-idled we want the
  // new timestamp, so a plain ZADD (update-if-exists) is correct.
  const result = await client.zadd(IDLE_KEY, idleSince, String(channelId));
  return result;
}

/**
 * Pop the channel that has been idle the longest (lowest score).
 *
 * @returns {Promise<{ channelId: string, idleSince: number } | null>}
 */
async function popOldestIdle() {
  // ZPOPMIN returns [member, score] or empty array
  const result = await client.zpopmin(IDLE_KEY, 1);
  if (!result || result.length === 0) return null;

  return {
    channelId: result[0],
    idleSince: Number(result[1]),
  };
}

/**
 * Remove a specific channel from the idle queue (e.g. when it gets
 * disapproved or manually pulled).
 *
 * @param {string|number} channelId
 * @returns {Promise<number>} 1 if removed, 0 if not present
 */
async function removeFromIdleQueue(channelId) {
  return client.zrem(IDLE_KEY, String(channelId));
}

/**
 * How many channels are currently idle?
 *
 * @returns {Promise<number>}
 */
async function getIdleQueueSize() {
  return client.zcard(IDLE_KEY);
}

/**
 * List idle channels ordered by idle duration (oldest first).
 *
 * @param {number} [limit=50] — max items to return
 * @returns {Promise<Array<{ channelId: string, idleSince: number }>>}
 */
async function getIdleQueueList(limit = 50) {
  // ZRANGE key 0 limit-1 WITHSCORES returns [m1, s1, m2, s2, …]
  const raw = await client.zrange(IDLE_KEY, 0, limit - 1, 'WITHSCORES');

  const items = [];
  for (let i = 0; i < raw.length; i += 2) {
    items.push({
      channelId: raw[i],
      idleSince: Number(raw[i + 1]),
    });
  }
  return items;
}

// ═══════════════════════════════════════════════════════════════════════════
// Waiting Article Queue
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Add an article to the waiting queue (no idle channel available right now).
 *
 * @param {string|number} articleId
 * @returns {Promise<number>}
 */
async function addToWaitingQueue(articleId) {
  const score = Date.now();
  return client.zadd(WAITING_KEY, score, String(articleId));
}

/**
 * Pop the next waiting article (FIFO — lowest score = earliest enqueued).
 *
 * @returns {Promise<string|null>} articleId or null if queue is empty
 */
async function popWaitingArticle() {
  const result = await client.zpopmin(WAITING_KEY, 1);
  if (!result || result.length === 0) return null;
  return result[0]; // just the articleId
}

/**
 * How many articles are waiting for a channel?
 *
 * @returns {Promise<number>}
 */
async function getWaitingQueueSize() {
  return client.zcard(WAITING_KEY);
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  // Idle channel queue
  addToIdleQueue,
  popOldestIdle,
  removeFromIdleQueue,
  getIdleQueueSize,
  getIdleQueueList,

  // Waiting article queue
  addToWaitingQueue,
  popWaitingArticle,
  getWaitingQueueSize,

  // Key names (exposed for tests / debugging)
  IDLE_KEY,
  WAITING_KEY,
};
