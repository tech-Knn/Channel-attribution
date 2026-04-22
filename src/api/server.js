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
const { verifyToken } = require('./middleware/auth'); 

const articlesRouter = require('./routes/articles');
const channelsRouter = require('./routes/channels');
const assignmentsRouter = require('./routes/assignments');
const revenueRouter = require('./routes/revenue');
const healthRouter = require('./routes/health');
const statsRouter = require('./routes/stats');



const { apiLimiter } = require('./middleware/rateLimiter'); 


const app = express();

// ── Middleware ──────────────────────────────────────────────────────────────

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(morgan('short'));
app.use(express.json({ limit: '1mb' }));



//  APPLY GLOBALLY 
app.use('/api', apiLimiter); 


const authRoutes = require('./routes/auth');

app.use(express.json());

// Mount your auth routes to /api/auth
app.use('/api/auth', authRoutes);

// ── Routes ─────────────────────────────────────────────────────────────────

const webhookRouter = require('./routes/webhook');

// Public routes (no auth required)
app.use('/api/health', healthRouter);
app.use('/api/webhook', webhookRouter);  // called by your publishing platform
app.use('/api/track', require('./routes/track'));  // page-view heartbeat, called from article pages

// Protected routes
app.use('/api/articles', verifyToken, articlesRouter);
app.use('/api/channels', verifyToken, channelsRouter);
app.use('/api/assignments', verifyToken, assignmentsRouter);
app.use('/api/revenue', verifyToken, revenueRouter);
app.use('/api/stats', verifyToken, statsRouter);

// ── Docs ───────────────────────────────────────────────────────────────────

app.use('/docs', express.static(path.join(__dirname, '../../docs')));

app.get('/', (req, res) => {
  res.json({ status: 'ok', version: '3.0' });
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
