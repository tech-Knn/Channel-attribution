'use strict';

const { getClient } = require('./ga4Client');
const config = require('../config');

// Single article traffic — used by the /traffic API endpoint
async function getArticleTraffic(pagePath) {
  const [response] = await getClient().runReport({
    property: `properties/${config.ga4.propertyId}`,
    dateRanges: [{ startDate: '1daysAgo', endDate: 'today' }],
    dimensions: [{ name: 'pagePath' }],
    metrics: [
      { name: 'activeUsers' },
      { name: 'sessions' },
      { name: 'screenPageViews' },
    ],
    dimensionFilter: {
      filter: {
        fieldName: 'pagePath',
        stringFilter: { value: pagePath },
      },
    },
  });

  const row = response.rows?.[0];
  if (!row) return { activeUsers: 0, sessions: 0, pageviews: 0 };

  return {
    activeUsers: parseInt(row.metricValues[0].value, 10),
    sessions:    parseInt(row.metricValues[1].value, 10),
    pageviews:   parseInt(row.metricValues[2].value, 10),
  };
}

// Batch query — single API call returning all pages that hit the threshold.
// Used by gaMonitor to avoid N per-article API calls.
async function getHighTrafficPages(threshold) {
  const [response] = await getClient().runReport({
    property: `properties/${config.ga4.propertyId}`,
    dateRanges: [{ startDate: '1daysAgo', endDate: 'today' }],
    dimensions: [{ name: 'pagePath' }],
    metrics: [{ name: 'activeUsers' }],
    metricFilter: {
      filter: {
        fieldName: 'activeUsers',
        numericFilter: {
          operation: 'GREATER_THAN_OR_EQUAL',
          value: { int64Value: String(threshold) },
        },
      },
    },
    limit: 1000,
  });

  if (!response.rows?.length) return new Map();

  const result = new Map();
  for (const row of response.rows) {
    const pagePath   = row.dimensionValues[0].value;
    const activeUsers = parseInt(row.metricValues[0].value, 10);
    result.set(pagePath, activeUsers);
  }
  return result;
}

module.exports = { getArticleTraffic, getHighTrafficPages };
