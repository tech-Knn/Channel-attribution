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
    publisherId: process.env.ADSENSE_PUBLISHER_ID || process.env.AFS_PUBLISHER_ID || '',
    apiKey: process.env.AFS_API_KEY || '',
  },

  // ── Slack Alerts ────────────────────────────────────────────
  slack: {
    webhookUrl: process.env.SLACK_WEBHOOK_URL || '',
  },

  // ── Google Analytics 4 ─────────────────────────────────────
  ga4: {
    propertyId:         process.env.GA4_PROPERTY_ID         || '',
    measurementId:      process.env.GA4_MEASUREMENT_ID      || '',
    serviceAccountPath: process.env.GA_SERVICE_ACCOUNT_PATH || './ga4-credentials.json',
    credentialsJson:    process.env.GA4_CREDENTIALS_JSON    || '',
  },

  // ── Pageview Tracking ───────────────────────────────────────
  tracking: {
    // Number of direct page views required to reactivate an expired article
    pageViewThreshold: parseInt(process.env.PAGE_VIEW_THRESHOLD, 10) || 5,
  },

  // ── Expiry Settings ─────────────────────────────────────────
  expiry: {
    // Minutes with zero traffic before a NEVER-VISITED article is expired
    zeroTrafficMinutes:      parseInt(process.env.EXPIRY_ZERO_TRAFFIC_MINUTES, 10)       || 5,
    // Minutes with zero traffic before a VISITED article is expired (much longer)
    trafficedExpiryMinutes:  parseInt(process.env.EXPIRY_TRAFFICKED_MINUTES, 10)         || 30,
    // How often expiry check runs (ms)
    checkIntervalMs:         parseInt(process.env.EXPIRY_CHECK_INTERVAL_MS, 10)          || 60 * 1000,
    // How often GA4 reactivation check runs (ms)
    ga4CheckIntervalMs:      parseInt(process.env.GA4_CHECK_INTERVAL_MS, 10)             || 60 * 1000,
  },

  // ── Application ─────────────────────────────────────────────
  app: {
    port: parseInt(process.env.PORT, 10) || 3000,
    env: process.env.NODE_ENV || 'development',
  },
};

module.exports = config;
