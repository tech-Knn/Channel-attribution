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

// Batch query — uses Realtime API (last 30 min) for near-instant reactivation detection.
// Falls back to standard 1-day report if realtime returns nothing.
async function getHighTrafficPages(threshold) {
  const client = getClient();
  const property = `properties/${config.ga4.propertyId}`;

  // Try Realtime API first (last 30 minutes)
  let realtimeMap = new Map();
  try {
    const [rtResponse] = await client.runRealtimeReport({
      property,
      dimensions: [{ name: 'unifiedPagePathScreen' }],
      metrics: [{ name: 'activeUsers' }],
      limit: 1000,
    });
    if (rtResponse.rows?.length) {
      for (const row of rtResponse.rows) {
        const pagePath   = row.dimensionValues[0].value;
        const activeUsers = parseInt(row.metricValues[0].value, 10);
        if (activeUsers >= threshold) realtimeMap.set(pagePath, activeUsers);
      }
    }
  } catch (err) {
    console.warn('[ga4Traffic] Realtime API error (falling back to daily):', err.message);
  }

  if (realtimeMap.size > 0) return realtimeMap;

  // Fallback: standard 1-day report
  const [response] = await client.runReport({
    property,
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
