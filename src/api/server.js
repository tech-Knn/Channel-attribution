/**
 * Express API Server
 *
 * Central app setup — CORS, helmet, morgan, JSON body parsing.
 * Mounts all route files and serves the dashboard as static files.
 */

'use strict';

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');

const articlesRouter = require('./routes/articles');
const channelsRouter = require('./routes/channels');
const assignmentsRouter = require('./routes/assignments');
const revenueRouter = require('./routes/revenue');
const healthRouter = require('./routes/health');

const app = express();

// ── Middleware ──────────────────────────────────────────────────────────────

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(morgan('short'));
app.use(express.json({ limit: '1mb' }));

// ── Routes ─────────────────────────────────────────────────────────────────

app.use('/api/articles', articlesRouter);
app.use('/api/channels', channelsRouter);
app.use('/api/assignments', assignmentsRouter);
app.use('/api/revenue', revenueRouter);
app.use('/api/health', healthRouter);

// ── Dashboard static files ─────────────────────────────────────────────────

app.use('/dashboard', express.static(path.join(__dirname, '../../dashboard-static')));
app.use('/docs', express.static(path.join(__dirname, '../../docs')));

// Redirect root to dashboard
app.get('/', (req, res) => {
  res.redirect('/dashboard');
});

// ── 404 handler ────────────────────────────────────────────────────────────

app.use((req, res) => {
  res.status(404).json({ error: 'Not found', path: req.originalUrl });
});

// ── Global error handler ───────────────────────────────────────────────────

app.use((err, req, res, _next) => {
  console.error(`[api] Error on ${req.method} ${req.originalUrl}:`, err.message);
  console.error(err.stack);

  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
  });
});

// ── Start function ─────────────────────────────────────────────────────────

function start(port = 3000) {
  return new Promise((resolve) => {
    const server = app.listen(port, () => {
      console.log(`[api] Server listening on port ${port}`);
      resolve(server);
    });
  });
}

module.exports = { app, start };
