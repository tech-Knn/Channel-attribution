'use strict';

const { OAuth2Client } = require('google-auth-library');
const axios = require('axios');

const BASE_URL = 'https://adsense.googleapis.com/v2';

let _cachedToken = null;
let _tokenExpiresAt = 0;

async function getAccessToken() {
  if (_cachedToken && Date.now() < _tokenExpiresAt - 60_000) {
    return _cachedToken;
  }

  const { ADSENSE_CLIENT_ID, ADSENSE_CLIENT_SECRET, ADSENSE_REFRESH_TOKEN } = process.env;

  if (!ADSENSE_CLIENT_ID || !ADSENSE_CLIENT_SECRET || !ADSENSE_REFRESH_TOKEN) {
    throw new Error('Missing OAuth2 credentials: ADSENSE_CLIENT_ID, ADSENSE_CLIENT_SECRET, ADSENSE_REFRESH_TOKEN');
  }

  const client = new OAuth2Client(ADSENSE_CLIENT_ID, ADSENSE_CLIENT_SECRET);
  client.setCredentials({ refresh_token: ADSENSE_REFRESH_TOKEN });

  const { token, res } = await client.getAccessToken();
  if (!token) throw new Error('Failed to obtain access token');

  _cachedToken = token;
  _tokenExpiresAt = Date.now() + (res?.data?.expires_in || 3600) * 1000;

  console.log('[afsClient] access token refreshed');
  return token;
}

// Pulls daily revenue from AdSense API grouped by CUSTOM_SEARCH_STYLE_ID.
// AdSense reports are day-granularity — repeated pulls upsert, no duplicates.
async function fetchRevenueData(publisherId, _apiKey, startTime, endTime) {
  const pubId = process.env.ADSENSE_PUBLISHER_ID || publisherId;
  if (!pubId) throw new Error('No publisher ID — set ADSENSE_PUBLISHER_ID in .env');

  const accountId = pubId.startsWith('accounts/') ? pubId : `accounts/${pubId}`;
  const accessToken = await getAccessToken();

  const start = new Date(startTime);
  const end   = new Date(endTime);

  // Google AdSense API requires repeated params for arrays: metrics=X&metrics=Y
  const qs = new URLSearchParams();
  qs.append('startDate.year',    String(start.getFullYear()));
  qs.append('startDate.month',   String(start.getMonth() + 1));
  qs.append('startDate.day',     String(start.getDate()));
  qs.append('endDate.year',      String(end.getFullYear()));
  qs.append('endDate.month',     String(end.getMonth() + 1));
  qs.append('endDate.day',       String(end.getDate()));
  qs.append('dimensions',        'CUSTOM_SEARCH_STYLE_ID');
  qs.append('metrics',           'ESTIMATED_EARNINGS');
  qs.append('metrics',           'IMPRESSIONS');
  qs.append('metrics',           'CLICKS');
  qs.append('reportingTimeZone', 'ACCOUNT_TIME_ZONE');

  console.log(`[afsClient] fetching ${accountId} ${start.toISOString().slice(0, 10)} → ${end.toISOString().slice(0, 10)}`);

  let response;
  try {
    response = await axios.get(`${BASE_URL}/${accountId}/reports:generate?${qs.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 15_000,
    });
  } catch (err) {
    if (err.response?.status === 401) {
      _cachedToken = null;
      _tokenExpiresAt = 0;
    }
    const msg = err.response?.data?.error?.message || err.message;
    throw new Error(`AdSense API error (${err.response?.status}): ${msg}`);
  }

  const rows = response.data.rows || [];
  if (!rows.length) {
    console.log('[afsClient] no revenue data for this window');
    return [];
  }

  // Cell order: CUSTOM_SEARCH_STYLE_ID, ESTIMATED_EARNINGS, IMPRESSIONS, CLICKS
  const result = rows
    .map((row) => {
      const c = row.cells || [];
      return {
        channelId:   c[0]?.value || '',
        revenue:     parseFloat(c[1]?.value || '0'),
        impressions: parseInt(c[2]?.value  || '0', 10),
        clicks:      parseInt(c[3]?.value  || '0', 10),
      };
    })
    .filter((r) => r.channelId && r.channelId !== 'NONE');

  console.log(`[afsClient] ${result.length} channel(s) with revenue`);
  return result;
}

module.exports = { fetchRevenueData };
