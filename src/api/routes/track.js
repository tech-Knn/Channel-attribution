'use strict';

const { Router } = require('express');
const { pool } = require('../../db/pool');
const { queues } = require('../../redis/queues');
const queries = require('../../db/queries');
const config = require('../../config');

const router = Router();

router.post('/pageview', async (req, res) => {
  res.json({ ok: true });

  try {
    const { url, articleId } = req.body || {};
    if (!url && !articleId) return;

    let row;
    if (articleId) {
      const { rows } = await pool.query(
        `SELECT id, status, domain, direct_pageviews FROM articles WHERE article_id = $1 LIMIT 1`,
        [String(articleId)],
      );
      row = rows[0];
    } else {
      let cleanUrl = url;
      try {
        const parsed = new URL(url);
        cleanUrl = parsed.origin + parsed.pathname.replace(/\/$/, '');
      } catch (_) {}

      const { rows } = await pool.query(
        `SELECT id, status, domain, direct_pageviews FROM articles WHERE url = $1 LIMIT 1`,
        [cleanUrl],
      );
      row = rows[0];
      if (!row) console.log(`[track] no match — raw: "${url}" clean: "${cleanUrl}"`);
    }

    if (!row) return;

    if (['assigned', 'active'].includes(row.status)) {
      const windowMinutes = config.expiry.zeroTrafficMinutes;
      // Keep last_traffic_at at the window boundary — don't overwrite with NOW()
      // so a visit within a window survives until the window ends, not just 5 min from visit
      await pool.query(
        `UPDATE articles
         SET last_traffic_at = CASE
               WHEN last_traffic_at > NOW() THEN last_traffic_at
               ELSE last_traffic_at + ($2 * INTERVAL '1 minute')
             END,
             direct_pageviews = direct_pageviews + 1
         WHERE id = $1`,
        [row.id, windowMinutes],
      );
      console.log(`[track] heartbeat article ${row.id}`);

    } else if (row.status === 'expired') {
      const { rows: updated } = await pool.query(
        `UPDATE articles SET direct_pageviews = direct_pageviews + 1
         WHERE id = $1 RETURNING direct_pageviews`,
        [row.id],
      );
      const views = updated[0]?.direct_pageviews ?? 0;
      const threshold = config.tracking.pageViewThreshold;

      console.log(`[track] expired article ${row.id} — ${views}/${threshold} views`);

      if (views >= threshold) {
        await pool.query(
          `UPDATE articles
           SET status = 'pending',
               expiry_reason    = NULL,
               expired_at       = NULL,
               last_traffic_at  = NULL,
               reactivated_at   = NOW(),
               direct_pageviews = 0
           WHERE id = $1`,
          [row.id],
        );

        await queries.addArticleLifecycleEvent(row.id, 'reactivated', 'direct_tracking', views);

        await queues.articleAssignment.add('reactivate-article', {
          articleId: row.id,
          domain: row.domain || 'articlespectrum.com',
        }, {
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
        });

        console.log(`[track] article ${row.id} reactivated after ${views} views`);
      }
    }
  } catch (err) {
    console.error('[track] pageview error:', err.message);
  }
});

module.exports = router;
