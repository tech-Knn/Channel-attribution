/**
 * Sync Redis state from PostgreSQL.
 *
 * Run this after seeding or whenever Redis needs to match the DB.
 * Loads idle channels into the Redis sorted set and syncs active assignments.
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { pool } = require('../src/db/pool');
const { client } = require('../src/redis/client');
const { addToIdleQueue } = require('../src/redis/channelQueue');
const { setChannelAssignment, setArticleChannel } = require('../src/redis/stateStore');

async function syncRedis() {
  console.log('[sync] Starting Redis sync from PostgreSQL...');

  // Clear existing Redis state
  const keys = await client.keys('ca:*');
  if (keys.length > 0) {
    await client.del(...keys);
    console.log(`[sync] Cleared ${keys.length} existing Redis keys`);
  }

  // 1. Load idle channels into domain-scoped sorted sets
  const { rows: idleChannels } = await pool.query(
    `SELECT id, idle_since, domain FROM channels WHERE status = 'idle' ORDER BY idle_since ASC`
  );

  for (const ch of idleChannels) {
    const score = ch.idle_since ? new Date(ch.idle_since).getTime() : Date.now();
    const domain = ch.domain || 'articlespectrum.com';
    await addToIdleQueue(ch.id, score, domain);
  }
  console.log(`[sync] Added ${idleChannels.length} idle channels to domain-scoped Redis queues`);

  // 2. Load active assignments into state store
  const { rows: activeAssignments } = await pool.query(
    `SELECT a.article_id, a.channel_id FROM assignments a WHERE a.status = 'active'`
  );

  for (const asgn of activeAssignments) {
    await setChannelAssignment(asgn.channel_id, asgn.article_id);
    await setArticleChannel(asgn.article_id, asgn.channel_id);
  }
  console.log(`[sync] Loaded ${activeAssignments.length} active assignments into Redis`);

  // 3. Channel statuses tracked in PostgreSQL (Redis used for queue + assignments only)

  console.log('[sync] ✅ Redis sync complete!');
  
  await client.quit();
  await pool.end();
  process.exit(0);
}

syncRedis().catch(err => {
  console.error('[sync] Fatal error:', err);
  process.exit(1);
});
