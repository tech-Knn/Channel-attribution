'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { BetaAnalyticsDataClient } = require('@google-analytics/data');
const config = require('../config');

let _client;
let _disabled = false;

function getClient() {
  if (_disabled) throw new Error('GA4 client is disabled — credentials not configured');

  if (!_client) {
    // Option 1: base64-encoded JSON in GA4_CREDENTIALS_JSON env var (production)
    if (config.ga4.credentialsJson) {
      const json = Buffer.from(config.ga4.credentialsJson, 'base64').toString('utf8');
      const tmpPath = path.join(os.tmpdir(), 'ga4-credentials.json');
      fs.writeFileSync(tmpPath, json, 'utf8');
      _client = new BetaAnalyticsDataClient({ keyFilename: tmpPath });
      return _client;
    }

    // Option 2: credentials file on disk (local dev)
    const credPath = config.ga4.serviceAccountPath;
    if (!fs.existsSync(credPath)) {
      _disabled = true;
      console.warn(`[ga4Client] no credentials found — GA4 features disabled`);
      throw new Error('GA4 client is disabled — credentials not configured');
    }
    _client = new BetaAnalyticsDataClient({ keyFilename: credPath });
  }
  return _client;
}

function isDisabled() {
  if (_disabled) return true;
  // Pre-check without throwing
  return !config.ga4.credentialsJson && !fs.existsSync(config.ga4.serviceAccountPath);
}

module.exports = { getClient, isDisabled };
