/**
 * Revenue Routes
 *
 * GET    /api/revenue/summary       — Overall revenue stats (today, 7d, 30d)
 * GET    /api/revenue/by-article    — Revenue per article (materialized view)
 * GET    /api/revenue/by-channel    — Revenue per channel (materialized view)
 * GET    /api/revenue/unattributed  — Revenue with no article assignment
 * GET    /api/revenue/timeline      — Per-pull revenue with date/domain filters
 * GET    /api/revenue/domains       — List of domains with totals (for dropdown)
 * POST   /api/revenue/refresh       — Manually refresh materialized views
 * POST   /api/revenue/pull          — Manually trigger an AdSense revenue pull
 */

'use strict';
const { Router } = require('express');
const queries = require('../../db/queries');
const { queues } = require('../../redis/queues');
const router = Router();

// ── GET /api/revenue/summary ───────────────────────────────────────────────

router.get('/summary', async (req, res, next) => {
  try {
    const summary = await queries.getRevenueSummary({
      from: req.query.from,
      to: req.query.to,
    });
    res.json({ data: summary });
  } catch (err) { next(err); }
});


// ── GET /api/revenue/timeline ──────────────────────────────────────────────
// Per-pull revenue events with date range and domain filters.
//
// Query params:
//   ?from=2026-05-01           — ISO date or datetime (default: 30 days ago)
//   ?to=2026-05-11             — ISO date or datetime (default: now)
//   ?domain=articlespectrum.com — filter by channel OR article domain
//   ?limit=100&offset=0        — pagination (default 100, max 500)
router.get('/timeline', async (req, res, next) => {
  try {
    const { from, to, domain, limit, offset } = req.query;
    const result = await queries.getRevenueTimeline({
      from, to, domain, limit, offset,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ── GET /api/revenue/domains ───────────────────────────────────────────────
// List all known domains with their channel/article counts and totals.
// Powers the frontend domain dropdown.
router.get('/domains', async (req, res, next) => {
  try {
    const data = await queries.getDomains();
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/revenue/by-article ────────────────────────────────────────────

router.get('/by-article', async (req, res, next) => {
  try {
    const { limit, offset, sortBy, sortDir, from, to } = req.query;
    const result = await queries.getRevenueByArticle({
      limit: Math.min(parseInt(limit, 10) || 50, 200),
      offset: parseInt(offset, 10) || 0,
      sortBy: sortBy || 'total_revenue',
      sortDir: sortDir || 'DESC',
      from, to,
    });
    res.json(result);
  } catch (err) { next(err); }
});

// ── POST /api/revenue/pull ─────────────────────────────────────────────────
// Manually queue an immediate AdSense revenue pull (don't wait for the
// 15-min repeatable). Returns the BullMQ job ID so progress can be tracked.
router.post('/pull', async (req, res, next) => {
  try {
    const job = await queues.revenueAttribution.add('manual-pull', {
      triggeredBy: req.user?.email || 'unknown',
      triggeredAt: new Date().toISOString(),
    });
    res.json({
      message: 'Revenue pull queued — check server logs for progress',
      jobId: job.id,
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/revenue/by-channel ────────────────────────────────────────────

router.get('/by-channel', async (req, res, next) => {
  try {
    const { limit, offset, sortBy, sortDir, from, to } = req.query;
    const result = await queries.getRevenueByChannel({
      limit: Math.min(parseInt(limit, 10) || 50, 200),
      offset: parseInt(offset, 10) || 0,
      sortBy: sortBy || 'total_revenue',
      sortDir: sortDir || 'DESC',
      from, to,
    });
    res.json(result);
  } catch (err) { next(err); }
});


// ── GET /api/revenue/unattributed ──────────────────────────────────────────

router.get('/unattributed', async (req, res, next) => {
  try {
    const { limit, offset, from, to } = req.query;
    const result = await queries.getUnattributedRevenue({
      limit: Math.min(parseInt(limit, 10) || 50, 200),
      offset: parseInt(offset, 10) || 0,
      from, to,
    });
    res.json(result);
  } catch (err) { next(err); }
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
