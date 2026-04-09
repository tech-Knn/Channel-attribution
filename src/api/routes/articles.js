/**
 * Article Routes
 *
 * POST   /api/articles          — Create article + trigger assignment job
 * GET    /api/articles          — List with filters & pagination
 * GET    /api/articles/:id      — Get article with assignment + revenue
 * GET    /api/articles/:id/revenue — Revenue breakdown for article
 */

'use strict';

const { Router } = require('express');
const queries = require('../../db/queries');
const { queues } = require('../../redis/queues');

const router = Router();

// ── POST /api/articles ─────────────────────────────────────────────────────

router.post('/', async (req, res, next) => {
  try {
    const { articleId, url, category, publishedAt } = req.body;

    // Validation
    if (!articleId) {
      return res.status(400).json({ error: 'articleId is required' });
    }
    if (!publishedAt) {
      return res.status(400).json({ error: 'publishedAt is required' });
    }

    const article = await queries.createArticle({
      articleId,
      url: url || null,
      category: category || null,
      status: 'pending',
      publishedAt: new Date(publishedAt),
    });

    // Trigger assignment job via BullMQ
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
      return res.status(409).json({ error: 'Article with this articleId already exists' });
    }
    next(err);
  }
});

// ── GET /api/articles ──────────────────────────────────────────────────────

router.get('/', async (req, res, next) => {
  try {
    const { status, category, dateFrom, dateTo, limit, offset } = req.query;

    const result = await queries.listArticles({
      status: status || undefined,
      category: category || undefined,
      dateFrom: dateFrom ? new Date(dateFrom) : undefined,
      dateTo: dateTo ? new Date(dateTo) : undefined,
      limit: Math.min(parseInt(limit, 10) || 50, 200),
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
    if (!article) {
      return res.status(404).json({ error: 'Article not found' });
    }

    // Get active assignment
    const assignment = await queries.getActiveAssignmentForArticle(article.id);

    // Get revenue summary
    const revenue = await queries.getArticleRevenue(article.id);

    res.json({
      data: {
        ...article,
        assignment: assignment || null,
        revenue: revenue.summary,
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
    if (!article) {
      return res.status(404).json({ error: 'Article not found' });
    }

    const revenue = await queries.getArticleRevenue(articleId);
    res.json({ data: revenue });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
