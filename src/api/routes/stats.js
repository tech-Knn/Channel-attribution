'use strict';

const { Router } = require('express');
const queries = require('../../db/queries');
const { processJob: runExpiry } = require('../../workers/expiryWorker');
const { processJob: runGaMonitor } = require('../../workers/gaMonitor');

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const stats = await queries.getDashboardStats();
    res.json({ data: stats });
  } catch (err) {
    next(err);
  }
});

router.get('/alerts', async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const rows = await queries.getRecentAlerts(limit);
    res.json({ data: rows, total: rows.length });
  } catch (err) {
    next(err);
  }
});

router.post('/run-expiry', async (req, res, next) => {
  try {
    const result = await runExpiry({ id: 'manual' });
    res.json({ message: 'Expiry check completed', result });
  } catch (err) {
    next(err);
  }
});

router.post('/run-ga-monitor', async (req, res, next) => {
  try {
    const result = await runGaMonitor({ id: 'manual' });
    res.json({ message: 'GA monitor cycle completed', result });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
