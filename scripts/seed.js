#!/usr/bin/env node

/**
 * Seed script — populates the database with sample channels and articles.
 *
 * Creates:
 *   - 100 channels  (external_id: ch-0001 … ch-0100)
 *   - 50 articles   (external_id: art-0001 … art-0050)
 *
 * Usage:
 *   node scripts/seed.js          # seed
 *   node scripts/seed.js --clean  # truncate all tables first, then seed
 *
 * Requires DATABASE_URL (or defaults to local docker-compose PG).
 */

const path = require('path');
// Load .env from project root
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const { pool, shutdown } = require('../src/db/pool');

// ── Helpers ──────────────────────────────────────────────────

/** Pad a number to a fixed width with leading zeros. */
const pad = (n, width = 4) => String(n).padStart(width, '0');

/** Random integer between min (inclusive) and max (inclusive). */
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

/** Random element from an array. */
const pick = (arr) => arr[randInt(0, arr.length - 1)];

/** Generate a random date within the last N days. */
const randomRecentDate = (daysBack = 30) => {
  const now = Date.now();
  const offset = randInt(0, daysBack * 24 * 60 * 60 * 1000);
  return new Date(now - offset);
};

// ── Categories for articles ──────────────────────────────────
const CATEGORIES = [
  'technology', 'finance', 'health', 'sports', 'entertainment',
  'politics', 'science', 'travel', 'food', 'lifestyle',
];

// ── Channel statuses (weighted towards idle for fresh seed) ──
const CHANNEL_STATUSES = [
  'idle', 'idle', 'idle', 'idle', 'idle',         // 50 % idle
  'assigned', 'assigned', 'assigned',               // 30 % assigned
  'disapproved',                                    // 10 %
  'manual_review',                                  // 10 %
];

// ── Article statuses ─────────────────────────────────────────
const ARTICLE_STATUSES = [
  'pending', 'pending', 'pending',                  // 30 %
  'assigned', 'assigned',                            // 20 %
  'active', 'active', 'active',                      // 30 %
  'expired',                                         // 10 %
  'stopped',                                         // 10 %
];

// ─────────────────────────────────────────────────────────────
// Main seed logic
// ─────────────────────────────────────────────────────────────

async function clean() {
  console.log('🧹  Cleaning existing data…');
  // Truncate in dependency order (cascade handles FKs)
  await pool.query(`
    TRUNCATE revenue_events, channel_log, assignments, channels, articles
    RESTART IDENTITY CASCADE
  `);
  console.log('   Done.');
}

async function seedChannels(count = 100) {
  console.log(`📡  Seeding ${count} channels…`);

  const values = [];
  const params = [];
  for (let i = 1; i <= count; i++) {
    const status = pick(CHANNEL_STATUSES);
    const idleSince = status === 'idle' ? randomRecentDate(14) : null;
    const offset = (i - 1) * 4;
    values.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4})`);
    params.push(
      1000 + i,                    // id (1001–1100)
      `ch-${pad(i)}`,             // external_id
      status,
      idleSince,
    );
  }

  const sql = `
    INSERT INTO channels (id, external_id, status, idle_since)
    VALUES ${values.join(',\n           ')}
    ON CONFLICT (id) DO NOTHING`;

  await pool.query(sql, params);
  console.log(`   Inserted ${count} channels.`);
}

async function seedArticles(count = 50) {
  console.log(`📰  Seeding ${count} articles…`);

  const values = [];
  const params = [];
  for (let i = 1; i <= count; i++) {
    const status = pick(ARTICLE_STATUSES);
    const publishedAt = randomRecentDate(7);
    const category = pick(CATEGORIES);
    const offset = (i - 1) * 6;
    values.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6})`);
    params.push(
      2000 + i,                                       // id (2001–2050)
      `art-${pad(i)}`,                                // external_id
      `https://example.com/articles/${pad(i)}`,       // url
      category,
      status,
      publishedAt,
    );
  }

  const sql = `
    INSERT INTO articles (id, external_id, url, category, status, published_at)
    VALUES ${values.join(',\n           ')}
    ON CONFLICT (id) DO NOTHING`;

  await pool.query(sql, params);
  console.log(`   Inserted ${count} articles.`);
}

async function main() {
  const args = process.argv.slice(2);
  const shouldClean = args.includes('--clean');

  console.log('');
  console.log('╔══════════════════════════════════════╗');
  console.log('║  Channel Attribution — Seed Script   ║');
  console.log('╚══════════════════════════════════════╝');
  console.log('');

  try {
    // Verify connection
    const { rows } = await pool.query('SELECT NOW() AS ts');
    console.log(`✅  Connected to database at ${rows[0].ts}`);
    console.log('');

    if (shouldClean) {
      await clean();
      console.log('');
    }

    await seedChannels(100);
    await seedArticles(50);

    console.log('');
    console.log('🎉  Seed complete!');

    // Quick summary
    const stats = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM channels)::int AS channels,
        (SELECT COUNT(*) FROM articles)::int AS articles
    `);
    console.log(`   Channels: ${stats.rows[0].channels}  |  Articles: ${stats.rows[0].articles}`);
    console.log('');
  } catch (err) {
    console.error('❌  Seed failed:', err.message);
    console.error(err.stack);
    process.exitCode = 1;
  } finally {
    await shutdown();
  }
}

main();
