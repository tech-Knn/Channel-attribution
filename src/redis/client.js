/**
 * Redis Client
 *
 * Singleton ioredis connection used by all Redis modules (channel queue,
 * state store, BullMQ queues). Handles connection lifecycle, error
 * recovery, and graceful shutdown.
 */

'use strict';

const Redis = require('ioredis');
const config = require('../config');

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

const isTLS = config.redis.url.startsWith('rediss://');

const client = new Redis(config.redis.url, {
  retryStrategy(times) {
    const delay = Math.min(times * 200, 5000);
    console.log(`[redis] reconnecting in ${delay}ms (attempt ${times})`);
    return delay;
  },
  reconnectOnError(err) {
    // Force reconnect on cluster failover or loading errors
    return err.message.includes('READONLY') || err.message.includes('LOADING');
  },
  maxRetriesPerRequest: null,   // Required by BullMQ — never reject queued cmds
  enableReadyCheck: true,
  lazyConnect: false,
  ...(isTLS && { tls: { rejectUnauthorized: false } }),
});

// ---------------------------------------------------------------------------
// Lifecycle events
// ---------------------------------------------------------------------------

client.on('connect', () => {
  console.log('[redis] connected');
});

client.on('ready', () => {
  console.log('[redis] ready — accepting commands');
});

client.on('error', (err) => {
  console.error('[redis] connection error:', err.message);
});

client.on('close', () => {
  console.log('[redis] connection closed');
});

client.on('reconnecting', (ms) => {
  console.log(`[redis] reconnecting in ${ms}ms`);
});

client.on('end', () => {
  console.log('[redis] connection ended (no more reconnects)');
});

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

/**
 * Disconnect cleanly. Call once during process shutdown.
 * Resolves when the underlying socket is closed.
 */
async function disconnect() {
  try {
    await client.quit();
    console.log('[redis] disconnected gracefully');
  } catch (err) {
    console.error('[redis] error during disconnect:', err.message);
    // Force-close if quit fails
    client.disconnect();
  }
}

// Shutdown is handled centrally by src/index.js — no signal handlers here.

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = { client, disconnect };
