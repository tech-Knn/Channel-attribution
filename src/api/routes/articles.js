/**
 * Article Routes
 *
 * POST   /api/articles                  — Create article + trigger assignment job
 * GET    /api/articles                  — List with filters & pagination
 * GET    /api/articles/:id              — Get article with assignment + revenue
 * GET    /api/articles/:id/revenue      — Revenue breakdown for article
 * GET    /api/articles/:id/traffic      — GA4 + revenue combined traffic view
 * GET    /api/articles/:id/lifecycle    — Lifecycle event history (reactivations, expiries)
 * POST   /api/articles/:id/reactivate   — Manually reactivate an expired article
 */

'use strict';

const { Router } = require('express');
const queries = require('../../db/queries');
const { queues } = require('../../redis/queues');

const router = Router();

// ── POST /api/articles ─────────────────────────────────────────────────────
//changes: added validations for URL duplicacy-
router.post('/', async (req, res, next) => {
  try {
    const { articleId, url, category, publishedAt } = req.body;

    if (!articleId) return res.status(400).json({ error: 'articleId is required' });
    if (!url) return res.status(400).json({ error: 'url is required' });
    if (!category) return res.status(400).json({ error: 'category is required' });
    if (!publishedAt) return res.status(400).json({ error: 'publishedAt is required' });

    const article = await queries.createArticle({
      articleId,
      url: url || null,
      category: category || null,
      status: 'pending',
      publishedAt: new Date(publishedAt),
    });

    await queues.articleAssignment.add('assign-article', {
      articleId: article.id,
      externalId: article.article_id,
    }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
    });

    res.status(201).json({ data: article, message: 'Article created, assignment job queued' });
  } catch (err) {
  if (err.code === '23505') {

    if (err.constraint === 'unique_url') {
      return res.status(409).json({
        error: 'Article with this URL already exists'
      });
    }

    if (err.constraint === 'articles_external_id_key') {
      return res.status(409).json({
        error: 'Article with this articleId already exists'
      });
    }

    if (err.constraint === 'articles_pkey') {
      return res.status(409).json({
        error: 'Primary key duplicate'
      });
    }
  }

  next(err);
}
});

// ── GET /api/articles ──────────────────────────────────────────────────────

router.get('/', async (req, res, next) => {
  try {
    const { status, category, dateFrom, dateTo, limit, offset } = req.query;

    const result = await queries.listArticles({
      status:   status   || undefined,
      category: category || undefined,
      dateFrom: dateFrom ? new Date(dateFrom) : undefined,
      dateTo:   dateTo   ? new Date(dateTo)   : undefined,
      limit:  Math.min(parseInt(limit,  10) || 50, 200),
      offset: parseInt(offset, 10) || 0,
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ── GET /api/articles/:id ──────────────────────────────────────────────────

router.get('/:id', async (req, res, next) => {
  try {
    const article = await queries.getArticleById(Number(req.params.id));
    if (!article) return res.status(404).json({ error: 'Article not found' });

    const [assignment, revenue] = await Promise.all([
      queries.getActiveAssignmentForArticle(article.id),
      queries.getArticleRevenue(article.id),
    ]);

    res.json({
      data: {
        ...article,
        assignment:    assignment || null,
        revenue:       revenue.summary,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/articles/:id/revenue ──────────────────────────────────────────

router.get('/:id/revenue', async (req, res, next) => {
  try {
    const articleId = Number(req.params.id);
    const article = await queries.getArticleById(articleId);
    if (!article) return res.status(404).json({ error: 'Article not found' });

    const revenue = await queries.getArticleRevenue(articleId);
    res.json({ data: revenue });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/articles/:id/traffic ──────────────────────────────────────────

router.get('/:id/traffic', async (req, res, next) => {
  try {
    const articleId = Number(req.params.id);
    const article = await queries.getArticleById(articleId);
    if (!article) return res.status(404).json({ error: 'Article not found' });

    const [gaMetrics, revenue] = await Promise.all([
      queries.getArticleGaMetrics(articleId),
      queries.getArticleRevenue(articleId),
    ]);

    res.json({
      data: {
        articleId,
        articleRef:    article.article_id,
        status:        article.status,
        lastTrafficAt: article.last_traffic_at,
        reactivatedAt: article.reactivated_at,
        usersGa:       gaMetrics?.users_ga   ?? null,
        sessions:      gaMetrics?.sessions   ?? null,
        pageviews:     gaMetrics?.pageviews  ?? null,
        checkedAt:     gaMetrics?.checked_at ?? null,
        revenue:       revenue.summary,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/articles/:id/lifecycle ───────────────────────────────────────

router.get('/:id/lifecycle', async (req, res, next) => {
  try {
    const articleId = Number(req.params.id);
    const article = await queries.getArticleById(articleId);
    if (!article) return res.status(404).json({ error: 'Article not found' });

    const events = await queries.getArticleLifecycle(articleId);
    res.json({ data: events, total: events.length });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/articles/:id/reactivate ──────────────────────────────────────

router.post('/:id/reactivate', async (req, res, next) => {
  try {
    const articleId = Number(req.params.id);
    const article = await queries.getArticleById(articleId);

    if (!article) return res.status(404).json({ error: 'Article not found' });

    if (article.status !== 'expired') {
      return res.status(409).json({
        error: `Cannot reactivate an article with status '${article.status}'`,
      });
    }

    const updated = await queries.reactivateArticle(articleId);
    await queries.addArticleLifecycleEvent(articleId, 'reactivated', 'manual');

    await queues.articleAssignment.add('reactivate-article', {
      articleId,
      externalId: article.article_id,
    }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
    });

    res.json({ data: updated, message: 'Article reactivated, channel assignment queued' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
