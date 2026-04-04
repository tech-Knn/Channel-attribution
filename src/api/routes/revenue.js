/**
 * Revenue Routes
 *
 * GET    /api/revenue/summary       — Overall revenue stats (today, 7d, 30d)
 * GET    /api/revenue/by-article    — Revenue per article (materialized view)
 * GET    /api/revenue/by-channel    — Revenue per channel (materialized view)
 * GET    /api/revenue/unattributed  — Revenue with no article assignment
 * POST   /api/revenue/refresh       — Manually refresh materialized views
 */

'use strict';

const { Router } = require('express');
const queries = require('../../db/queries');

const router = Router();

// ── GET /api/revenue/summary ───────────────────────────────────────────────

router.get('/summary', async (req, res, next) => {
  try {
    const summary = await queries.getRevenueSummary();
    res.json({ data: summary });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/revenue/by-article ────────────────────────────────────────────

router.get('/by-article', async (req, res, next) => {
  try {
    const { limit, offset, sortBy, sortDir } = req.query;

    const result = await queries.getRevenueByArticle({
      limit: Math.min(parseInt(limit, 10) || 50, 200),
      offset: parseInt(offset, 10) || 0,
      sortBy: sortBy || 'total_revenue',
      sortDir: sortDir || 'DESC',
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ── GET /api/revenue/by-channel ────────────────────────────────────────────

router.get('/by-channel', async (req, res, next) => {
  try {
    const { limit, offset, sortBy, sortDir } = req.query;

    const result = await queries.getRevenueByChannel({
      limit: Math.min(parseInt(limit, 10) || 50, 200),
      offset: parseInt(offset, 10) || 0,
      sortBy: sortBy || 'total_revenue',
      sortDir: sortDir || 'DESC',
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ── GET /api/revenue/unattributed ──────────────────────────────────────────

router.get('/unattributed', async (req, res, next) => {
  try {
    const { limit, offset } = req.query;

    const result = await queries.getUnattributedRevenue({
      limit: Math.min(parseInt(limit, 10) || 50, 200),
      offset: parseInt(offset, 10) || 0,
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ── POST /api/revenue/refresh ──────────────────────────────────────────────

router.post('/refresh', async (req, res, next) => {
  try {
    const result = await queries.refreshMaterializedViews();
    res.json({ data: result, message: 'Materialized views refreshed' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
