# AdSense API Setup — TRT (AFS Only)

This document covers the complete setup for **AdSense for Search (AFS)** revenue integration for the TRT publisher (`topreserchtopics.com`) in AdSyntheX.

---

## 1. Google AdSense API Endpoint

Base URL:
```
https://adsense.googleapis.com/v2/
```

| Purpose | Method | URL |
|---|---|---|
| List publisher accounts | GET | `https://adsense.googleapis.com/v2/accounts` |
| Generate revenue report | GET | `https://adsense.googleapis.com/v2/{accountId}/reports:generate` |

`{accountId}` format: `accounts/pub-XXXXXXXXXXXXXXXXX`  
Example: `accounts/pub-6567805284657549`

---

## 2. Authentication

All calls use **OAuth2 Bearer tokens** via `google-auth-library`.

Flow:
1. Use `refresh_token` → get short-lived `access_token`
2. Send as `Authorization: Bearer <access_token>` header

**Never use API keys** — AdSense API requires OAuth2 only.

---

## 3. Required Environment Variables

Add these to `.env.local`:

```env
ADSENSE_CLIENT_ID=<Google OAuth2 Client ID>
ADSENSE_CLIENT_SECRET=<Google OAuth2 Client Secret>
ADSENSE_REFRESH_TOKEN=<OAuth2 Refresh Token>
ADSENSE_PUBLISHER_ID=pub-XXXXXXXXXXXXXXXXX
```

> **Important:** `ADSENSE_REFRESH_TOKEN` must be generated using `ADSENSE_CLIENT_ID` + `ADSENSE_CLIENT_SECRET`. Do NOT use the Google Ads client ID — they are separate OAuth apps.

---

## 4. Key Source Files

| File | Purpose |
|---|---|
| `lib/adsense-api.ts` | Core — OAuth client, report fetching, account listing |
| `lib/mcc-config.ts` | MCC credentials + account → MCC mapping |
| `lib/account-access-control.ts` | Per-account feed permission (`'adsense'` feed for TRT) |
| `app/api/adsense-accounts/route.ts` | `GET /api/adsense-accounts` |
| `app/api/adsense-cost-revenue/route.ts` | `POST /api/adsense-cost-revenue` |

---

## 5. How OAuth Client is Resolved (`lib/adsense-api.ts`)

For `adsenseAccountType = 'afs'` (TRT), credentials are resolved in this order:

1. `ADSENSE_CLIENT_ID` / `ADSENSE_CLIENT_SECRET` (dedicated AdSense creds)
2. Falls back to `GOOGLE_ADS_CLIENT_ID` / `GOOGLE_ADS_CLIENT_SECRET` from MCC config

Refresh token order:
1. `ADSENSE_REFRESH_TOKEN` from MCC config (`mcc-config.ts` → `adSense.refreshToken`)
2. Falls back to `GOOGLE_ADS_REFRESH_TOKEN`

---

## 6. MCC Config for AdSense (`lib/mcc-config.ts`)

```ts
primary: {
  mccId: process.env.GOOGLE_ADS_MANAGER_ID,
  googleAds: { ... },
  adSense: {
    refreshToken: process.env.ADSENSE_REFRESH_TOKEN,
    publisherId: process.env.ADSENSE_PUBLISHER_ID,
  }
}
```

---

## 7. Account Access Control (`lib/account-access-control.ts`)

Every Google Ads account that should use AFS revenue must be registered with `['adsense']` feed:

```ts
// Active TRT AFS accounts
'CID_9249163427': ['adsense'],   // TRT-AFS 01
'CID_1209239435': ['adsense'],   // AFS-TRT-IST-01
'CID_8804029676': ['adsense'],   // AFS-TRT-IST-02
'CID_7993255100': ['adsense'],   // AFS-TRT-IST-03
'CID_1910623888': ['adsense'],   // AFS-TRT-IST-04
'CID_3516620995': ['adsense'],   // AFS-TRT-IST-05
'CID_3723100505': ['adsense'],   // AFS-TRT-IST-06
'CID_7667229570': ['adsense'],   // AFS-TRT-IST-07
'CID_5312022044': ['adsense'],   // AFS-TRT-IST-08
'CID_6117738068': ['adsense'],   // AFS-TRT-IST-09
'CID_8862303731': ['adsense'],   // AFS-TRT-IST-10
'CID_8811269949': ['adsense'],   // AFS-TRT-IST-11
'CID_1013027376': ['adsense'],   // AFS-TRT-IST-12
'CID_4518158484': ['adsense'],   // AFS-TRT-IST-13
'CID_1056018921': ['adsense'],   // AFS-TRT-IST-14
'CID_8739175417': ['adsense'],   // AFS-TRT-IST-15
```

---

## 8. Internal API Routes

### GET `/api/adsense-accounts`
Returns the TRT publisher account fetched via AdSense API.

Response:
```json
{
  "accounts": [
    {
      "name": "accounts/pub-6567805284657549",
      "displayName": "Oarex Funding LLC",
      "state": "READY",
      "type": "afs",
      "mcc": "primary"
    }
  ],
  "total": 1,
  "breakdown": { "afs": 1, "carhp": 0 }
}
```

If the API token fails, it falls back to a hardcoded account:
- `accounts/pub-6567805284657549` — Oarex Funding LLC

---

### POST `/api/adsense-cost-revenue`
Fetches AFS revenue data for given accounts and date range.

Request body:
```json
{
  "startDate": "2026-01-01",
  "endDate": "2026-01-31",
  "adsenseAccountId": "accounts/pub-6567805284657549",
  "adsenseAccountType": "afs",
  "customerId": "9249163427",
  "accountIds": ["9249163427", "1209239435"],
  "forceLive": false
}
```

- `adsenseAccountType` must be `"afs"` for TRT
- `forceLive: true` bypasses Redis cache

Response:
```json
{
  "revenueByStyleId": [...],
  "summary": {
    "totalEarnings": 0.0,
    "totalClicks": 0,
    "totalImpressions": 0,
    "uniqueStyleIds": 0,
    "uniqueDomains": 0
  },
  "_source": "live | aggregated_cache | account_cache",
  "_cacheAge": "120s"
}
```

---

## 9. Revenue Report — Dimensions & Metrics

**Dimensions fetched from AdSense API:**
- `DATE`
- `CUSTOM_SEARCH_STYLE_ID`
- `COUNTRY_NAME`
- `DOMAIN_NAME`

**Metrics fetched:**
- `ESTIMATED_EARNINGS`
- `IMPRESSIONS`
- `CLICKS`

---

## 10. Caching

| Cache Level | TTL | Notes |
|---|---|---|
| Individual account | 1 hour | Per account + date range |
| Aggregated view | 2 hours | All accounts combined |

Cache engine: **Redis** via `lib/redis-cache-manager.ts`  
Cache key pattern: `afs_aggregated:{accountIds}:{adsenseAccountId}:{startDate}:{endDate}`

---

## 11. Generating the OAuth Refresh Token (one-time)

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create an **OAuth 2.0 Client ID** (type: Web or Desktop)
3. Enable **AdSense Management API** in the project
4. Add scope: `https://www.googleapis.com/auth/adsense.readonly`
5. Use [OAuth 2.0 Playground](https://developers.google.com/oauthplayground/) or a local script to complete the flow
6. Copy the `refresh_token` → set as `ADSENSE_REFRESH_TOKEN` in `.env.local`

> The OAuth app (`ADSENSE_CLIENT_ID`) must be the same app used to generate the `ADSENSE_REFRESH_TOKEN`. Mixing client IDs from different apps will fail.
