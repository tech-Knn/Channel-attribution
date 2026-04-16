# GA4 Integration — Implementation Plan

## Problem
When an article expires (zero traffic 72h), its channel is freed. If traffic returns later,
there is no mechanism to detect it or reassign a channel. Revenue leaks silently.

## Solution
GA4 as a secondary monitor. A background worker polls GA4 every 60s for `expired` articles.
If `activeUsers >= threshold`, the article is reset to `pending` and the existing matching engine
re-assigns an idle channel automatically.

---

## Schema Changes

### 1. Migrate `articles` table — add two columns
```sql
ALTER TABLE articles ADD COLUMN last_traffic_at TIMESTAMPTZ;
ALTER TABLE articles ADD COLUMN reactivated_at  TIMESTAMPTZ;
```
- `last_traffic_at` — updated every time GA4 reports users > 0 (active articles only)
- `reactivated_at`  — set when an expired article is reactivated via GA4 detection

### 2. New table: `article_ga_metrics`
One row per article. Upserted on every GA4 poll cycle.
```sql
CREATE TABLE article_ga_metrics (
    article_id   BIGINT PRIMARY KEY REFERENCES articles(id),
    users_ga     INTEGER NOT NULL DEFAULT 0,
    sessions     INTEGER NOT NULL DEFAULT 0,
    pageviews    INTEGER NOT NULL DEFAULT 0,
    checked_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```
- Intentionally no `revenue/cost/profit` — those live in `revenue_events` + materialized views

### 3. New table: `article_lifecycle`
Audit trail for reactivation / expiry events triggered by the GA worker.
```sql
CREATE TABLE article_lifecycle (
    id            BIGSERIAL PRIMARY KEY,
    article_id    BIGINT NOT NULL REFERENCES articles(id),
    event         VARCHAR(30) NOT NULL,   -- reactivated | expired | monitored
    triggered_by  VARCHAR(30),            -- ga4 | manual | zero_traffic
    active_users  INTEGER,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_article_lifecycle_article ON article_lifecycle(article_id, created_at);
```

---

## New Files

### `src/workers/ga4Client.js`
Singleton `BetaAnalyticsDataClient` initialised from `GA_SERVICE_ACCOUNT_PATH`.

### `src/workers/ga4Traffic.js`
`getArticleTraffic(pagePath)` — calls `runReport`, returns `{ activeUsers, sessions, pageviews }`.

### `src/workers/gaMonitor.js`
BullMQ worker on queue `ga-monitor`. Repeatable job every 60s.
- Fetches all `active` + `expired` articles that have a non-null `url`
- Calls `getArticleTraffic` per article using `new URL(article.url).pathname`
- Upserts `article_ga_metrics`
- Runs lifecycle decisions:
  - `expired` + `users_ga >= GA4_REACTIVATION_THRESHOLD` → reset to `pending`, queue assignment
  - `active` + `users_ga > 0` → update `articles.last_traffic_at`

### `src/db/migrations/003_ga4_integration.sql`
All DDL from schema changes above. Idempotent (`IF NOT EXISTS` / `IF NOT EXISTS`).

---

## New DB Queries (`src/db/queries.js` additions)

| Function | Purpose |
|---|---|
| `getArticlesForGaMonitor()` | SELECT active + expired articles with non-null url |
| `upsertArticleGaMetrics(articleId, data)` | INSERT … ON CONFLICT DO UPDATE |
| `reactivateArticle(articleId, client)` | Sets status=pending, reactivated_at=NOW() |
| `addArticleLifecycleEvent(articleId, event, triggeredBy, activeUsers)` | INSERT into article_lifecycle |
| `updateArticleLastTrafficAt(articleId)` | Sets last_traffic_at=NOW() on active article |
| `getArticleGaMetrics(articleId)` | SELECT from article_ga_metrics |

---

## New API Endpoints

Both added to `src/api/routes/articles.js`.

### `POST /api/articles/:id/reactivate`
Manual reactivation (operator-triggered). Does same thing the worker does programmatically.
- Auth: JWT required
- 404 if article not found
- 409 if article is not in `expired` status
- Resets to `pending`, queues assignment job, logs lifecycle event
- Response: `{ data: article, message }`

### `GET /api/articles/:id/traffic`
Returns combined GA4 metrics + revenue summary for an article.
- Auth: JWT required
- Response: `{ data: { articleId, status, usersGa, sessions, pageviews, checkedAt, revenue: { total, impressions, clicks } } }`

---

## Config Additions (`src/config/index.js`)

```js
ga4: {
  propertyId:           process.env.GA4_PROPERTY_ID || '',
  serviceAccountPath:   process.env.GA_SERVICE_ACCOUNT_PATH || '',
  reactivationThreshold: parseInt(process.env.GA4_REACTIVATION_THRESHOLD, 10) || 30,
},
```

---

## Package

```bash
npm install @google-analytics/data
```

---

## Worker Registration (`src/index.js` or wherever workers boot)

Register `gaMonitor` worker alongside existing workers.
Add repeatable job to the `ga-monitor` queue with `every: 60_000`.

---

## Implementation Order

- [x] 1. Migration SQL file (`src/db/migrations/003_ga4_integration.sql`)
- [x] 2. Config additions (`src/config/index.js`)
- [x] 3. Install `@google-analytics/data`
- [x] 4. `src/workers/ga4Client.js`
- [x] 5. `src/workers/ga4Traffic.js`
- [x] 6. New queries in `src/db/queries.js`
- [x] 7. `src/workers/gaMonitor.js`
- [x] 8. Worker + queue registered in `src/index.js` + `src/redis/queues.js`
- [x] 9. New endpoints in `src/api/routes/articles.js`
- [x] 10. `.env.example` additions

---

## Decisions / Rules

| Decision | Rationale |
|---|---|
| `stopped` status removed from articles | `expiry_reason` (`zero_traffic \| manual \| disapproved`) already captures why. Can be added back later if needed. |
| GA worker monitors `expired` articles only (excl. `disapproved`) | Single clear target for reactivation. Query: `status='expired' AND expiry_reason != 'disapproved'` |
| Reactivation resets to `pending`, not `active` | Lets existing matchingEngine handle channel assignment cleanly |
| `article_ga_metrics` has no revenue columns | Revenue data already in `revenue_events` + materialized views |
| pagePath derived from `article.url` | GA4 tracks actual URL paths, not internal PKs |
| Articles with null `url` are skipped | Cannot build a pagePath filter without a URL |
| GA4 worker uses BullMQ repeatable job, not `node-cron` | Consistent with rest of system, survives restarts |
