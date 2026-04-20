'use strict';

const fs = require('fs');
const { BetaAnalyticsDataClient } = require('@google-analytics/data');
const config = require('../config');

let _client;
let _disabled = false;

function getClient() {
  if (_disabled) throw new Error('GA4 client is disabled — credentials file not found');

  if (!_client) {
    const credPath = config.ga4.serviceAccountPath;
    if (!fs.existsSync(credPath)) {
      _disabled = true;
      console.warn(`[ga4Client] credentials file not found at "${credPath}" — GA4 features disabled`);
      throw new Error('GA4 client is disabled — credentials file not found');
    }
    _client = new BetaAnalyticsDataClient({ keyFilename: credPath });
  }
  return _client;
}

function isDisabled() {
  return _disabled;
}

module.exports = { getClient, isDisabled };
