/**
 * State Store — Redis hash-based assignment lookups.
 *
 * Two mappings for O(1) lookups in either direction:
 *   - channel → article:  `ca:channel_assignment:{channelId}` → articleId
 *   - article → channel:  `ca:article_channel:{articleId}`   → channelId
 */

'use strict';

const { client } = require('./client');

// ---------------------------------------------------------------------------
// Key helpers
// ---------------------------------------------------------------------------

function channelKey(channelId) {
  return `ca:channel_assignment:${channelId}`;
}

function articleKey(articleId) {
  return `ca:article_channel:${articleId}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Channel → Article mapping
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Record that a channel is assigned to an article.
 */
async function setChannelAssignment(channelId, articleId) {
  await client.set(channelKey(channelId), String(articleId));
}

/**
 * Get the article currently assigned to a channel.
 * @returns {Promise<string|null>}
 */
async function getChannelAssignment(channelId) {
  return client.get(channelKey(channelId));
}

/**
 * Remove the channel → article mapping (channel freed).
 */
async function removeChannelAssignment(channelId) {
  await client.del(channelKey(channelId));
}

// ═══════════════════════════════════════════════════════════════════════════
// Article → Channel mapping
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Record that an article has been assigned a channel.
 */
async function setArticleChannel(articleId, channelId) {
  await client.set(articleKey(articleId), String(channelId));
}

/**
 * Get the channel assigned to an article.
 * @returns {Promise<string|null>}
 */
async function getArticleChannel(articleId) {
  return client.get(articleKey(articleId));
}

/**
 * Remove the article → channel mapping.
 */
async function removeArticleChannel(articleId) {
  await client.del(articleKey(articleId));
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  setChannelAssignment,
  getChannelAssignment,
  removeChannelAssignment,
  setArticleChannel,
  getArticleChannel,
  removeArticleChannel,
};
