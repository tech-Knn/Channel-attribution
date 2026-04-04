/**
 * Health Check Routes
 *
 * GET /api/health — Check PostgreSQL and Redis connectivity
 */

'use strict';

const { Router } = require('express');
const { pool } = require('../../db/pool');
const { client } = require('../../redis/client');

const router = Router();

router.get('/', async (req, res) => {
  const checks = { postgres: 'unknown', redis: 'unknown' };
  let healthy = true;

  // PostgreSQL
  try {
    const { rows } = await pool.query('SELECT 1 AS ok');
    checks.postgres = rows[0].ok === 1 ? 'healthy' : 'degraded';
  } catch (err) {
    checks.postgres = 'unhealthy';
    checks.postgresError = err.message;
    healthy = false;
  }

  // Redis
  try {
    const pong = await client.ping();
    checks.redis = pong === 'PONG' ? 'healthy' : 'degraded';
  } catch (err) {
    checks.redis = 'unhealthy';
    checks.redisError = err.message;
    healthy = false;
  }

  const status = healthy ? 200 : 503;
  res.status(status).json({
    status: healthy ? 'healthy' : 'unhealthy',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    checks,
  });
});

module.exports = router;
