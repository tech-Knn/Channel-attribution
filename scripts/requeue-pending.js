/**
 * Requeue Pending Articles
 *
 * Finds all articles with status = 'pending' in the DB that have no active
 * assignment, then queues a BullMQ assignment job for each one so the
 * matching engine can assign idle channels to them.
 *
 * Use cases:
 *  - Articles stuck in pending after a system restart
 *  - Articles that were published before channels were available
 *  - Recovery after Redis waiting queue data loss
 *
 * NOTE: This script only touches 'pending' articles.
 *       Expired article reactivation is handled separately by the
 *       reactivationWorker (GA4 traffic threshold logic).
 *
 * Usage:
 *   node scripts/requeue-pending.js
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { pool } = require('../src/db/pool');
const { queues } = require('../src/redis/queues');

async function requeuePending() {
  console.log('[requeue] Starting pending article requeue...');

  // Find all pending articles with no active assignment
  const { rows: pendingArticles } = await pool.query(`
    SELECT a.id, a.article_id, a.domain
    FROM articles a
    LEFT JOIN assignments asgn
      ON asgn.article_id = a.id AND asgn.status = 'active'
    WHERE a.status = 'pending'
      AND asgn.id IS NULL
    ORDER BY a.published_at ASC
  `);

  if (pendingArticles.length === 0) {
    console.log('[requeue] No pending articles found — nothing to do.');
    await cleanup();
    return;
  }

  console.log(`[requeue] Found ${pendingArticles.length} pending article(s) — queuing assignment jobs...`);

  let queued = 0;
  for (const article of pendingArticles) {
    await queues.articleAssignment.add('assign-article', {
      articleId: article.id,
      externalId: article.article_id,
      domain: article.domain || 'articlespectrum.com',
    }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
    });

    console.log(`[requeue]   → Article ${article.article_id} (id: ${article.id}, domain: ${article.domain}) queued`);
    queued++;
  }

  console.log(`[requeue] Done — ${queued} job(s) queued. Matching engine will assign channels shortly.`);

  await cleanup();
}

async function cleanup() {
  await pool.end();
  process.exit(0);
}

requeuePending().catch(err => {
  console.error('[requeue] Fatal error:', err);
  process.exit(1);
});
