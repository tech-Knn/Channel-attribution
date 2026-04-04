/**
 * AFS Reporting API Client (Stub)
 *
 * This module provides the interface for pulling revenue data from the
 * AdSense for Search Reporting API. Currently returns sample data —
 * replace the implementation with actual API calls when ready.
 *
 * The contract is stable: all consumers import fetchRevenueData() and
 * get back the same shape regardless of whether it's stubbed or live.
 */

'use strict';

/**
 * @typedef {Object} ChannelRevenue
 * @property {string} channelId   — AFS channel external ID
 * @property {number} impressions — Number of ad impressions in the period
 * @property {number} clicks      — Number of ad clicks in the period
 * @property {number} revenue     — Revenue in USD for the period
 */

/**
 * Fetch revenue data from the AFS Reporting API.
 *
 * @param {string} publisherId — AFS publisher ID (e.g. "partner-pub-XXXX")
 * @param {string} apiKey      — AFS API key
 * @param {Date}   startTime   — Start of the reporting window
 * @param {Date}   endTime     — End of the reporting window
 * @returns {Promise<ChannelRevenue[]>} Array of per-channel revenue records
 */
async function fetchRevenueData(publisherId, apiKey, startTime, endTime) {
  // ──────────────────────────────────────────────────────────────────────
  // STUB: Replace this with actual AFS Reporting API call.
  //
  // Real implementation would:
  //   1. Build request URL with publisherId, date range params
  //   2. Set Authorization header with apiKey
  //   3. Parse the CSV/JSON response
  //   4. Map to ChannelRevenue[] shape
  //
  // Example with fetch:
  //   const url = `https://www.googleapis.com/adsense/v2/accounts/${publisherId}/reports`;
  //   const response = await fetch(url, {
  //     headers: { Authorization: `Bearer ${apiKey}` },
  //     ...
  //   });
  // ──────────────────────────────────────────────────────────────────────

  console.log(
    `[afsClient] Fetching revenue data for ${publisherId} ` +
    `from ${startTime.toISOString()} to ${endTime.toISOString()} (STUB)`,
  );

  // Return sample data that exercises all code paths
  return [
    {
      channelId: '1001',
      impressions: 2450,
      clicks: 38,
      revenue: 12.4500,
    },
    {
      channelId: '1002',
      impressions: 1800,
      clicks: 22,
      revenue: 8.7200,
    },
    {
      channelId: '1003',
      impressions: 500,
      clicks: 5,
      revenue: 1.2000,
    },
    {
      channelId: '9999', // Channel with no assignment — tests orphan detection
      impressions: 300,
      clicks: 3,
      revenue: 0.9500,
    },
  ];
}

module.exports = { fetchRevenueData };
