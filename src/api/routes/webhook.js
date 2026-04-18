/**
 * Webhook Route — called by your external publishing platform
 *
 * POST /api/webhook/article-published
 *
 * When a user publishes an article on your CMS/platform,
 * that platform calls this endpoint. No JWT needed — uses
 * a shared secret (WEBHOOK_SECRET in .env).
 *
 * This creates the article record and queues the matching
 * engine to automatically assign the oldest idle channel.
 */

'use strict';

const { Router } = require('express');
const queries    = require('../../db/queries');
const { queues } = require('../../redis/queues');

const router = Router();

// ── POST /api/webhook/article-published ────────────────────────────────────

router.post('/article-published', async (req, res, next) => {
  try {
    // Verify shared secret — your CMS must send this header
    const secret = req.headers['x-webhook-secret'];
    if (!secret || secret !== process.env.WEBHOOK_SECRET) {
      return res.status(401).json({ error: 'Invalid webhook secret' });
    }

    const { articleId, url, category, publishedAt, domain } = req.body;

    if (!articleId) {
      return res.status(400).json({ error: 'articleId is required' });
    }
    if (!publishedAt) {
      return res.status(400).json({ error: 'publishedAt is required' });
    }

    const articleDomain = domain || 'articlespectrum.com';

    // Create article in DB — id is auto-generated
    const article = await queries.createArticle({
      articleId: String(articleId),
      url:        url || null,
      category:   category || null,
      status:     'pending',
      publishedAt: new Date(publishedAt),
      domain:     articleDomain,
    });

    // Queue the matching engine — it will pick the oldest idle channel for this domain
    await queues.articleAssignment.add('assign-article', {
      articleId: article.id,
      externalId: article.article_id,
      domain:    articleDomain,
    }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
    });

    console.log(`[webhook] Article ${article.article_id} received → assignment queued`);

    // Respond immediately — assignment happens async
    res.status(202).json({
      message: 'Article received. Channel assignment in progress.',
      articleId: article.id,
      articleRef: article.article_id,
    });

  } catch (err) {
    // Article already exists — safe to ignore (idempotent)
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Article already registered', articleId: req.body.articleId });
    }
    next(err);
  }
});

module.exports = router;
