'use strict';

const { Router } = require('express');
const queries = require('../../db/queries');

const router = Router();

// GET /api/stats — summary counts for dashboard header cards
router.get('/', async (req, res, next) => {
  try {
    const stats = await queries.getDashboardStats();
    res.json({ data: stats });
  } catch (err) {
    next(err);
  }
});

// GET /api/alerts — recent expiries, orphan revenue, disapprovals
router.get('/alerts', async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const rows = await queries.getRecentAlerts(limit);
    res.json({ data: rows, total: rows.length });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
