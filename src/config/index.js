/**
 * Configuration module — loads environment variables with sensible local-dev defaults.
 *
 * Usage:
 *   const config = require('./config');
 *   console.log(config.database.url);
 */

require('dotenv').config();

const config = {
  // ── PostgreSQL ──────────────────────────────────────────────
  database: {
    url: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/channel_attribution',
  },

  // ── Redis ───────────────────────────────────────────────────
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },

  // ── AFS (AdSense for Search) Reporting API ─────────────────
  afs: {
    publisherId: process.env.AFS_PUBLISHER_ID || '',
    apiKey: process.env.AFS_API_KEY || '',
  },

  // ── Slack Alerts ────────────────────────────────────────────
  slack: {
    webhookUrl: process.env.SLACK_WEBHOOK_URL || '',
  },

  // ── Application ─────────────────────────────────────────────
  app: {
    port: parseInt(process.env.PORT, 10) || 3000,
    env: process.env.NODE_ENV || 'development',
  },
};

module.exports = config;
