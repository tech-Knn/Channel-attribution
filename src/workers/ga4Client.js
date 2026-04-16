'use strict';

const { BetaAnalyticsDataClient } = require('@google-analytics/data');
const config = require('../config');

let _client;

function getClient() {
  if (!_client) {
    _client = new BetaAnalyticsDataClient({
      keyFilename: config.ga4.serviceAccountPath,
    });
  }
  return _client;
}

module.exports = { getClient };
