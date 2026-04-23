'use strict';

/**
 * Track Route — public, no auth required.
 *
 * POST /api/track/pageview
 *   Called from article pages when a visitor loads the page.
 *   Works without GA4.
 *
 *   - assigned/active article  → refreshes last_traffic_at (prevents expiry)
 *   - expired article          → increments direct_pageviews; reactivates when >= threshold
 */

const { Router } = require('express');
const { pool } = require('../../db/pool');
const { queues } = require('../../redis/queues');
const queries = require('../../db/queries');
const config = require('../../config');

const router = Router();

router.post('/pageview', async (req, res) => {
  // Respond immediately — tracking must never slow down or break the article page
  res.json({ ok: true });

  try {
    const { url, articleId } = req.body || {};
    if (!url && !articleId) return;

    // Look up the article by external articleId or by URL
    let row;
    if (articleId) {
      const { rows } = await pool.query(
        `SELECT id, status, domain, direct_pageviews FROM articles WHERE article_id = $1 LIMIT 1`,
        [String(articleId)],
      );
      row = rows[0];
    } else {
      // Strip query params, hash, and trailing slash so the lookup matches
      // regardless of UTM tags or other parameters added by the browser
      let cleanUrl = url;
      try {
        const parsed = new URL(url);
        cleanUrl = parsed.origin + parsed.pathname.replace(/\/$/, '');
      } catch (_) { /* invalid URL — use as-is */ }

      const { rows } = await pool.query(
        `SELECT id, status, domain, direct_pageviews FROM articles WHERE url = $1 LIMIT 1`,
        [cleanUrl],
      );
      row = rows[0];
      if (!row) console.log(`[track] no match for URL — raw: "${url}" clean: "${cleanUrl}"`);
    }

    if (!row) return; // unknown URL — ignore silently

    if (['assigned', 'active'].includes(row.status)) {
      // Advance last_traffic_at to the END of the current window.
      // If we're still inside the current window (last_traffic_at > NOW()), keep it.
      // If the window has passed, move to the next window boundary.
      // This means: any visit within a 5-min block keeps the article alive
      // until the END of that block — not just 5 min from the visit time.
      const windowMinutes = config.expiry.zeroTrafficMinutes;
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
      console.log(`[track] heartbeat for article ${row.id} (${row.status})`);

    } else if (row.status === 'expired') {
      // Increment view counter; reactivate once threshold is hit
      const { rows: updated } = await pool.query(
        `UPDATE articles SET direct_pageviews = direct_pageviews + 1
         WHERE id = $1 RETURNING direct_pageviews`,
        [row.id],
      );
      const views = updated[0]?.direct_pageviews ?? 0;
      const threshold = config.tracking.pageViewThreshold;

      console.log(`[track] expired article ${row.id} — ${views}/${threshold} views`);

      if (views >= threshold) {
        // Reactivate: move back to pending so matching engine assigns a channel
        await pool.query(
          `UPDATE articles
           SET status = 'pending',
               expiry_reason   = NULL,
               expired_at      = NULL,
               last_traffic_at = NULL,
               reactivated_at  = NOW(),
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

        console.log(`[track] article ${row.id} reactivated — ${views} direct page views`);
      }
    }
  } catch (err) {
    console.error('[track] pageview error:', err.message);
  }
});

module.exports = router;
