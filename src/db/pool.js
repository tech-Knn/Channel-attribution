/**
 * PostgreSQL connection pool.
 *
 * Uses the pg package with connection string from config.
 * Includes graceful shutdown on process signals.
 */

const { Pool } = require('pg');
const config = require('../config');

const pool = new Pool({
  connectionString: config.database.url,
  // Sensible pool defaults for ~2,000 channels workload
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Log unexpected errors on idle clients so they don't crash the process
pool.on('error', (err) => {
  console.error('[pool] Unexpected error on idle client:', err.message);
});

/**
 * Gracefully drain the pool. Call on process shutdown.
 */
async function shutdown() {
  console.log('[pool] Draining connections…');
  await pool.end();
  console.log('[pool] All connections closed.');
}

// Shutdown is handled centrally by src/index.js — no signal handlers here.

module.exports = { pool, shutdown };
