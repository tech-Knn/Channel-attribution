'use strict';

require('dotenv').config();

const fs   = require('fs');
const path = require('path');
const config = require('./config');
const { pool } = require('./db/pool');
const { client: redisClient, disconnect: redisDisconnect } = require('./redis/client');
const { setupRepeatableJobs, closeAll: closeQueues } = require('./redis/queues');

async function ensureSchema() {
  const schemaPath = path.join(__dirname, 'db', 'schema.sql');
  if (!fs.existsSync(schemaPath)) return;

  const client = await pool.connect();
  try {
    const { rows } = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'channels'
      ) AS exists
    `);

    if (rows[0].exists) {
      console.log('[boot] schema exists — skipping');
      return;
    }

    console.log('[boot] applying schema.sql...');
    await client.query(fs.readFileSync(schemaPath, 'utf8'));
    console.log('[boot] schema applied');
  } finally {
    client.release();
  }
}

async function testPostgres() {
  const client = await pool.connect();
  try {
    const { rows } = await client.query('SELECT NOW() AS time');
    console.log(`[boot] postgres connected — ${rows[0].time}`);
  } finally {
    client.release();
  }
}

async function testRedis() {
  const pong = await redisClient.ping();
  console.log(`[boot] redis connected — ${pong}`);
}

function loadWorkers() {
  const { createMatchingEngineWorker }      = require('./workers/matchingEngine');
  const { createChannelStateWorker }        = require('./workers/channelState');
  const { createRevenueAttributionWorker }  = require('./workers/revenueAttribution');
  const { createExpiryWorker }              = require('./workers/expiryWorker');
  const { createGaMonitorWorker }           = require('./workers/gaMonitor');

  createMatchingEngineWorker();
  createChannelStateWorker();
  createRevenueAttributionWorker();
  createExpiryWorker();
  createGaMonitorWorker();

  console.log('[boot] workers started');
}

async function startAPI() {
  const { start } = require('./api/server');
  const port = config.app.port || 3000;
  await start(port);
}

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] ${signal} received`);

  try { await closeQueues(); } catch (e) { console.error('[shutdown]', e.message); }
  try { await redisDisconnect(); } catch (e) { console.error('[shutdown]', e.message); }
  try { await pool.end(); } catch (e) { console.error('[shutdown]', e.message); }

  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

async function main() {
  console.log(`[boot] environment: ${config.app.env}`);

  try {
    await testPostgres();
    await testRedis();
    await ensureSchema();
    await setupRepeatableJobs();
    loadWorkers();
    await startAPI();
    console.log('[boot] system ready');
  } catch (err) {
    console.error('[boot] fatal error during startup:', err);
    process.exit(1);
  }
}

main();
