'use strict';

const { Router } = require('express');
const queries = require('../../db/queries');
const { processJob: runExpiry } = require('../../workers/expiryWorker');
const { processJob: runGaMonitor } = require('../../workers/gaMonitor');
const { queues } = require('../../redis/queues');

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
    res.status(500).json({ error: err.message, stack: err.stack });
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

router.get('/debug', async (req, res, next) => {
  try {
    const { getIdleQueueSize, getWaitingQueueSize } = require('../../redis/channelQueue');
    const domain = req.query.domain || 'articlespectrum.com';

    const [idleInRedis, waitingInRedis, queueCounts] = await Promise.all([
      getIdleQueueSize(domain),
      getWaitingQueueSize(domain),
      Promise.all(
        Object.entries(queues).map(async ([name, q]) => {
          const [waiting, active, failed] = await Promise.all([
            q.getWaitingCount(),
            q.getActiveCount(),
            q.getFailedCount(),
          ]);
          return { queue: name, waiting, active, failed };
        }),
      ),
    ]);

    res.json({ domain, idleInRedis, waitingInRedis, queues: queueCounts });
  } catch (err) {
    next(err);
  }
});

router.post('/reconcile', async (req, res, next) => {
  try {
    const { pool } = require('../../db/pool');
    const { addToIdleQueue } = require('../../redis/channelQueue');
    const { queues: q } = require('../../redis/queues');

    // Re-sync idle channels to Redis
    const { rows: idleChannels } = await pool.query(
      `SELECT id, idle_since, domain FROM channels WHERE status = 'idle' ORDER BY idle_since ASC`,
    );
    for (const ch of idleChannels) {
      const score = ch.idle_since ? new Date(ch.idle_since).getTime() : Date.now();
      await addToIdleQueue(ch.id, score, ch.domain || 'articlespectrum.com');
    }

    // Re-queue pending articles
    const { rows: pending } = await pool.query(
      `SELECT a.id, a.article_id, a.domain FROM articles a
       LEFT JOIN assignments asgn ON asgn.article_id = a.id AND asgn.status = 'active'
       WHERE a.status = 'pending' AND asgn.id IS NULL`,
    );
    for (const article of pending) {
      await q.articleAssignment.add('reconcile-pending', {
        articleId: article.id,
        externalId: article.article_id,
        domain: article.domain || 'articlespectrum.com',
      }, { attempts: 3, backoff: { type: 'exponential', delay: 2000 } });
    }

    res.json({ idleChannelsSynced: idleChannels.length, pendingArticlesQueued: pending.length });
  } catch (err) {
    next(err);
  }
});

router.post('/drain-failed', async (req, res, next) => {
  try {
    const { queues: q } = require('../../redis/queues');
    const results = {};
    for (const [name, queue] of Object.entries(q)) {
      const count = await queue.getFailedCount();
      if (count > 0) {
        await queue.clean(0, 10000, 'failed');
        results[name] = count;
      }
    }
    res.json({ message: 'Failed jobs cleared', cleared: results });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
