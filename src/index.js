/**
 * Channel Attribution System — Main Entry Point
 *
 * Boots PostgreSQL, Redis, BullMQ workers, and the API server.
 * Handles graceful shutdown on SIGTERM/SIGINT.
 */

'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const config = require('./config');
const { pool } = require('./db/pool');
const { client: redisClient, disconnect: redisDisconnect } = require('./redis/client');
const { setupRepeatableJobs, closeAll: closeQueues } = require('./redis/queues');

// Workers are self-registering — requiring them starts their BullMQ listeners
let workersLoaded = false;

// ─── Startup ───────────────────────────────────────────────

async function ensureSchema() {
  const schemaPath = path.join(__dirname, 'db', 'schema.sql');
  if (!fs.existsSync(schemaPath)) {
    console.warn('[boot] schema.sql not found — skipping auto-migration');
    return;
  }

  const client = await pool.connect();
  try {
    // Check if tables already exist
    const { rows } = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'channels'
      ) AS exists
    `);

    if (rows[0].exists) {
      console.log('[boot] Schema already exists — skipping migration');
      return;
    }

    console.log('[boot] Running schema.sql ...');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    await client.query(schema);
    console.log('[boot] Schema applied successfully');
  } finally {
    client.release();
  }
}

async function testPostgres() {
  const client = await pool.connect();
  try {
    const { rows } = await client.query('SELECT NOW() AS time');
    console.log(`[boot] PostgreSQL connected — server time: ${rows[0].time}`);
  } finally {
    client.release();
  }
}

async function testRedis() {
  const pong = await redisClient.ping();
  console.log(`[boot] Redis connected — PING: ${pong}`);
}

function loadWorkers() {
  console.log('[boot] Starting workers...');
  
  const { createMatchingEngineWorker } = require('./workers/matchingEngine');
  createMatchingEngineWorker();
  console.log('[boot]   ✓ Matching Engine');
  
  const { createChannelStateWorker } = require('./workers/channelState');
  createChannelStateWorker();
  console.log('[boot]   ✓ Channel State');
  
  const { createRevenueAttributionWorker } = require('./workers/revenueAttribution');
  createRevenueAttributionWorker();
  console.log('[boot]   ✓ Revenue Attribution');
  
  const { createExpiryWorker } = require('./workers/expiryWorker');
  createExpiryWorker();
  console.log('[boot]   ✓ Expiry Worker');
  
  workersLoaded = true;
}

async function startAPI() {
  const { start } = require('./api/server');
  const port = config.app?.port || config.port || 3000;
  await start(port);
  console.log(`[boot] API server listening on port ${port}`);
}

// ─── Graceful Shutdown ─────────────────────────────────────

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[shutdown] Received ${signal} — shutting down gracefully...`);

  try {
    // Close BullMQ queues (stops repeatable jobs)
    if (typeof closeQueues === 'function') {
      await closeQueues();
      console.log('[shutdown] BullMQ queues closed');
    }
  } catch (err) {
    console.error('[shutdown] Error closing queues:', err.message);
  }

  try {
    // Disconnect Redis
    await redisDisconnect();
    console.log('[shutdown] Redis disconnected');
  } catch (err) {
    console.error('[shutdown] Error closing Redis:', err.message);
  }

  try {
    // Close PostgreSQL pool
    await pool.end();
    console.log('[shutdown] PostgreSQL pool closed');
  } catch (err) {
    console.error('[shutdown] Error closing PG pool:', err.message);
  }

  console.log('[shutdown] Goodbye.');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// ─── Boot Sequence ─────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║   Channel Attribution System v1.0        ║');
  console.log('║   Starting up...                         ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log(`[boot] Environment: ${config.app?.env || 'development'}`);

  try {
    // 1. Test database connection
    await testPostgres();

    // 2. Test Redis connection
    await testRedis();

    // 3. Apply schema if needed
    await ensureSchema();

    // 4. Set up repeatable BullMQ jobs
    await setupRepeatableJobs();
    console.log('[boot] Repeatable jobs scheduled (revenue: 15m, expiry: 1h)');

    // 5. Start workers
    loadWorkers();

    // 6. Start API server
    await startAPI();

    console.log('');
    console.log('╔══════════════════════════════════════════╗');
    console.log('║   ✅ System is live and ready             ║');
    console.log('╚══════════════════════════════════════════╝');
    console.log('');
  } catch (err) {
    console.error('[boot] Fatal error during startup:', err);
    process.exit(1);
  }
}

main();
