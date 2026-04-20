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

    if (!rows[0].exists) {
      console.log('[boot] applying schema.sql...');
      await client.query(fs.readFileSync(schemaPath, 'utf8'));
      console.log('[boot] schema applied');
    } else {
      console.log('[boot] schema exists — skipping base schema');
    }
  } finally {
    client.release();
  }
}

/**
 * Run all pending SQL migration files in order.
 * Tracks applied migrations in a `schema_migrations` table.
 */
async function runMigrations() {
  const migrationsDir = path.join(__dirname, 'db', 'migrations');
  if (!fs.existsSync(migrationsDir)) {
    console.log('[boot] no migrations directory — skipping');
    return;
  }

  const client = await pool.connect();
  try {
    // Ensure migrations tracking table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Get already-applied migrations
    const { rows: applied } = await client.query(
      `SELECT filename FROM schema_migrations ORDER BY filename`
    );
    const appliedSet = new Set(applied.map(r => r.filename));

    // Get all migration files sorted
    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    let appliedCount = 0;
    for (const file of files) {
      if (appliedSet.has(file)) {
        continue; // already applied
      }

      console.log(`[boot] applying migration: ${file}`);
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          `INSERT INTO schema_migrations (filename) VALUES ($1)`,
          [file]
        );
        await client.query('COMMIT');
        console.log(`[boot] migration applied: ${file}`);
        appliedCount++;
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`[boot] migration FAILED: ${file} —`, err.message);
        throw err;
      }
    }

    if (appliedCount === 0) {
      console.log('[boot] migrations: all up-to-date');
    } else {
      console.log(`[boot] migrations: ${appliedCount} applied`);
    }
  } finally {
    client.release();
  }
}

/**
 * Sync idle channels from PostgreSQL into domain-scoped Redis sorted sets.
 * This ensures Redis always reflects the DB state after a restart or wipe.
 */
async function syncIdleChannelsToRedis() {
  const { addToIdleQueue } = require('./redis/channelQueue');

  const { rows: idleChannels } = await pool.query(
    `SELECT id, idle_since, domain FROM channels WHERE status = 'idle' ORDER BY idle_since ASC`
  );

  if (idleChannels.length === 0) {
    console.log('[boot] sync: no idle channels in DB');
    return;
  }

  for (const ch of idleChannels) {
    const score = ch.idle_since ? new Date(ch.idle_since).getTime() : Date.now();
    const domain = ch.domain || 'articlespectrum.com';
    await addToIdleQueue(ch.id, score, domain);
  }

  console.log(`[boot] sync: loaded ${idleChannels.length} idle channels into Redis`);
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

/**
 * On every startup, find pending articles with no active assignment
 * and re-queue them so the matching engine assigns channels automatically.
 * This heals the system after restarts or Redis wipes.
 *
 * NOTE: Only touches 'pending' articles.
 *       Expired article reactivation is handled separately by gaMonitor worker.
 */
async function reconcilePendingArticles() {
  const { queues } = require('./redis/queues');

  const { rows: pending } = await pool.query(`
    SELECT a.id, a.article_id, a.domain
    FROM articles a
    LEFT JOIN assignments asgn
      ON asgn.article_id = a.id AND asgn.status = 'active'
    WHERE a.status = 'pending'
      AND asgn.id IS NULL
    ORDER BY a.published_at ASC
  `);

  if (pending.length === 0) {
    console.log('[boot] reconcile: no pending articles — all good');
    return;
  }

  console.log(`[boot] reconcile: ${pending.length} pending article(s) found — re-queuing...`);

  for (const article of pending) {
    await queues.articleAssignment.add('assign-article', {
      articleId: article.id,
      externalId: article.article_id,
      domain: article.domain || 'articlespectrum.com',
    }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
    });
  }

  console.log(`[boot] reconcile: ${pending.length} job(s) queued for matching engine`);
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
    await runMigrations();          // apply any pending SQL migrations
    await syncIdleChannelsToRedis(); // load idle channels from DB → Redis
    await setupRepeatableJobs();
    loadWorkers();
    await startAPI();
    await reconcilePendingArticles(); // re-queue any pending articles
    console.log('[boot] system ready');
  } catch (err) {
    console.error('[boot] fatal error during startup:', err);
    process.exit(1);
  }
}

main();
