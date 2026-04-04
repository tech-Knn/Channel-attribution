# Standard Operating Procedure
# Channel Utilisation & Revenue Attribution

**Version:** 3.0  
**Audience:** Engineering  
**Status:** Active  
**Updated:** April 2026

---

## 01 — The Problem

We have around 2,000 channels and publish roughly 10,000 articles a month.

At any given moment a chunk of those channels sits idle — either disapproved, not delivering, or simply never assigned. New articles keep coming in but there is no automatic way to connect them to the channels that are free.

On top of this, some articles that do get a channel never generate any traffic. These articles hold onto a channel indefinitely, blocking it from being used by something that could actually earn revenue.

This causes two problems:
1. **Revenue is lost** every hour a channel sits unused or is tied to a dead article.
2. **Reporting is unreliable** because assignments are inconsistent — we cannot cleanly say which channel earned what.

This document describes the system built to fix all of this.

---

## 02 — Architecture Overview

### Design Principles
- **Minimal infrastructure.** Only what we need, nothing more.
- **PostgreSQL is the source of truth.** Every assignment, every revenue record, permanently stored.
- **Redis handles hot state.** Channel queue, assignment lookups, job scheduling.
- **Ship fast, scale later.** Kafka and ClickHouse are not needed at 2,000 channels / 10,000 articles per month. If we 10x, we add them.

### Stack

| Component | Tool | Purpose |
|-----------|------|---------|
| **State & Queue** | Redis | Channel idle queue, real-time assignment lookup, BullMQ job processing |
| **Database** | PostgreSQL | Source of truth — channels, articles, assignments, revenue records, analytics |
| **Workers** | Node.js | Matching engine, attribution service, expiry worker, AFS pull |
| **Dashboard** | Frontend (React/Next.js) | Revenue per channel, per article, idle loss, assignment history |

### What We Removed (and Why)

| Removed | Reason |
|---------|--------|
| **Kafka** | BullMQ (Redis-based) handles all event/job processing at our scale. One fewer system to deploy and monitor. |
| **ClickHouse** | PostgreSQL with proper indexes and materialized views handles analytics at 2,000 channels. Not worth a separate OLAP system. |

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────┐
│                      INPUTS                              │
├──────────────┬──────────────┬──────────────┬────────────┤
│ Article      │ Channel      │ AFS Reporting│ Cron       │
│ System       │ System       │ API          │ Scheduler  │
│ (new article │ (status      │ (revenue     │ (triggers  │
│  published)  │  changes)    │  pull every  │  expiry    │
│              │              │  15 min)     │  checks)   │
└──────┬───────┴──────┬───────┴──────┬───────┴─────┬──────┘
       │              │              │             │
       ▼              ▼              ▼             ▼
┌─────────────────────────────────────────────────────────┐
│                    BullMQ (Redis)                        │
│                                                         │
│  Queues:                                                │
│  ├── article-assignment   (new article → assign channel)│
│  ├── channel-state-change (idle/active/disapproved)     │
│  ├── revenue-attribution  (AFS data → per-article rev)  │
│  └── article-expiry       (3-day zero-traffic check)    │
│                                                         │
│  State:                                                 │
│  ├── channel:idle (sorted set — idle channels by time)  │
│  ├── channel:assigned:{id} → article_id (hash)         │
│  └── article:channel:{id} → channel_id (hash)          │
└──────┬───────┬──────────────┬───────────────┬───────────┘
       │       │              │               │
       ▼       ▼              ▼               ▼
┌─────────────────────────────────────────────────────────┐
│                  NODE.JS WORKERS                         │
│                                                         │
│  ┌─────────────────┐  ┌──────────────────┐             │
│  │ Matching Engine  │  │ Attribution      │             │
│  │                  │  │ Service          │             │
│  │ • Picks longest- │  │                  │             │
│  │   idle channel   │  │ • Pulls AFS API  │             │
│  │ • Assigns to     │  │   every 15 min   │             │
│  │   article        │  │ • Matches revenue│             │
│  │ • Writes to PG   │  │   to assignment  │             │
│  │ • Updates Redis  │  │ • Writes to PG   │             │
│  └─────────────────┘  └──────────────────┘             │
│                                                         │
│  ┌─────────────────┐  ┌──────────────────┐             │
│  │ Expiry Worker   │  │ Channel State    │             │
│  │                  │  │ Worker           │             │
│  │ • Runs hourly    │  │                  │             │
│  │ • Checks day-3   │  │ • Listens for    │             │
│  │   articles       │  │   status changes │             │
│  │ • Zero traffic?  │  │ • Updates Redis  │             │
│  │   → reclaim      │  │   queue          │             │
│  │   channel        │  │ • Flags          │             │
│  │ • Push channel   │  │   disapproved    │             │
│  │   back to queue  │  │   → Slack alert  │             │
│  └─────────────────┘  └──────────────────┘             │
└──────────────────────────┬──────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                    POSTGRESQL                            │
│                                                         │
│  Tables:                                                │
│  ├── channels        (id, status, idle_since, ...)      │
│  ├── articles        (id, status, published_at, ...)    │
│  ├── assignments     (article_id, channel_id,           │
│  │                    assigned_at, unassigned_at,        │
│  │                    status)                            │
│  ├── revenue_events  (channel_id, article_id,           │
│  │                    impressions, clicks, revenue,      │
│  │                    period_start, period_end,          │
│  │                    pulled_at)                         │
│  └── channel_log     (channel_id, event, timestamp,     │
│                       metadata)                          │
│                                                         │
│  Materialized Views:                                    │
│  ├── mv_revenue_per_article  (refreshed every 15 min)   │
│  ├── mv_revenue_per_channel  (refreshed every 15 min)   │
│  └── mv_idle_channel_loss    (refreshed hourly)         │
│                                                         │
│  Key Indexes:                                           │
│  ├── assignments(channel_id, assigned_at)               │
│  ├── assignments(article_id)                            │
│  ├── revenue_events(channel_id, period_start)           │
│  └── articles(published_at, status)                     │
└──────────────────────────┬──────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                    DASHBOARD                             │
│                                                         │
│  Views:                                                 │
│  ├── Revenue per article (with channel, assignment time)│
│  ├── Revenue per channel (with article history)         │
│  ├── Idle channels (sorted by idle duration)            │
│  ├── Zero-traffic articles (expired, reclaimed)         │
│  ├── Channel utilisation rate (% active vs idle)        │
│  └── Revenue lost to idle time (estimated)              │
│                                                         │
│  Data source: PostgreSQL (direct queries + mat views)   │
└─────────────────────────────────────────────────────────┘
```

---

## 03 — What Happens Step by Step

### When a New Article Is Published

| # | Action | What Happens | Tool |
|---|--------|-------------|------|
| 1 | Article event fires | Publishing system sends a signal that a new article is live | BullMQ job |
| 2 | Matching engine picks it up | Worker processes the `article-assignment` job | Node.js |
| 3 | Idle channel fetched | Picks the channel that has been idle the longest from the sorted set | Redis ZPOPMIN |
| 4 | Assignment written | `article_id` + `channel_id` + `assigned_at` saved permanently | PostgreSQL |
| 5 | Redis state updated | `channel:assigned:{id}` and `article:channel:{id}` set | Redis |
| 6 | Dashboard reflects it | New assignment visible on next page load | Dashboard |

**If no idle channel is available:** Article enters a waiting queue in Redis. The moment any channel becomes idle, it is assigned immediately.

---

### When a Channel Goes Idle

| # | Action | What Happens | Tool |
|---|--------|-------------|------|
| 1 | Channel status changes | System detects the channel is now idle or disapproved | BullMQ job |
| 2 | Redis state updated | Channel marked idle with timestamp | Redis |
| 3 | Added to idle queue | Channel joins the sorted set, ranked by `idle_since` | Redis ZADD |
| 4 | Waiting article check | If an unassigned article is in the queue — assign immediately | Matching engine |
| 5 | Disapproved? | Disapproved channels skip the idle queue → Slack alert for manual review | Slack webhook |

---

### When Revenue Data Is Pulled (Every 15 Minutes)

| # | Action | What Happens | Tool |
|---|--------|-------------|------|
| 1 | Cron triggers pull | BullMQ repeatable job fires every 15 minutes | BullMQ |
| 2 | AFS API called | Fetch revenue data by channel for the last 30 minutes (overlapping window for safety) | Node.js |
| 3 | Channel → Article lookup | For each channel with revenue, find the active assignment | Redis / PostgreSQL |
| 4 | Revenue record written | `channel_id`, `article_id`, `impressions`, `clicks`, `revenue`, `period_start`, `period_end` saved | PostgreSQL |
| 5 | Materialized views refreshed | `mv_revenue_per_article` and `mv_revenue_per_channel` updated | PostgreSQL |
| 6 | Dashboard reflects it | Revenue visible per article and per channel | Dashboard |

**Deduplication:** Revenue records are keyed on `channel_id` + `period_start`. Overlapping pulls don't create duplicates — they upsert.

---

### When an Article Has Zero Traffic for 3 Days

A BullMQ repeatable job runs every hour.

| # | Action | What Happens | Tool |
|---|--------|-------------|------|
| 1 | Expiry worker runs | Queries PostgreSQL for articles published between 72–96 hours ago with zero revenue events | PostgreSQL |
| 2 | Article marked expired | `status = expired`, `expired_at = now`, `reason = zero_traffic` | PostgreSQL |
| 3 | Assignment closed | `unassigned_at = now`, `status = completed` — attribution window is sealed | PostgreSQL |
| 4 | Channel freed | `status = idle`, `idle_since = now`, pushed back into Redis sorted set | Redis |
| 5 | Channel reassigned | If a waiting article exists, matching engine picks it up immediately | Matching engine |

**Important:** Articles older than 96 hours are NOT re-checked. The window is exactly day 3 (72–96h). This prevents unnecessary queries on old data.

---

## 04 — Revenue Attribution Logic

Attribution is timestamp-based, not guess-based.

```
Article X assigned Channel C at 2026-04-01 10:00:00
Article X unassigned Channel C at 2026-04-04 10:00:00

Any revenue on Channel C between those two timestamps = Article X's revenue.
```

**Edge cases:**

| Scenario | How It's Handled |
|----------|-----------------|
| Channel reassigned mid-day | Revenue before `unassigned_at` → old article. Revenue after new `assigned_at` → new article. |
| Gap between unassign and reassign | Revenue during gap is flagged as `unattributed` — visible in dashboard for investigation. |
| Channel has revenue but no active assignment | Flagged as `orphan_revenue` — Slack alert. Should not happen if system is healthy. |
| AFS pull delayed | Overlapping pull windows (30 min window every 15 min) ensure no data is missed. Upsert prevents duplicates. |

---

## 05 — Database Schema

### channels
```sql
CREATE TABLE channels (
    id              BIGINT PRIMARY KEY,
    external_id     VARCHAR(20) NOT NULL UNIQUE,  -- AFS channel ID
    status          VARCHAR(20) NOT NULL DEFAULT 'idle',
                    -- idle | assigned | disapproved | manual_review
    idle_since      TIMESTAMPTZ,
    assigned_to     BIGINT REFERENCES articles(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_channels_status ON channels(status);
CREATE INDEX idx_channels_idle_since ON channels(idle_since) WHERE status = 'idle';
```

### articles
```sql
CREATE TABLE articles (
    id              BIGINT PRIMARY KEY,
    external_id     VARCHAR(100) NOT NULL UNIQUE,  -- your CMS article ID
    url             TEXT,
    category        VARCHAR(50),
    status          VARCHAR(20) NOT NULL DEFAULT 'pending',
                    -- pending | assigned | active | expired | stopped
    published_at    TIMESTAMPTZ NOT NULL,
    expired_at      TIMESTAMPTZ,
    expiry_reason   VARCHAR(50),  -- zero_traffic | manual | disapproved
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_articles_status ON articles(status);
CREATE INDEX idx_articles_published ON articles(published_at, status);
```

### assignments
```sql
CREATE TABLE assignments (
    id              BIGSERIAL PRIMARY KEY,
    article_id      BIGINT NOT NULL REFERENCES articles(id),
    channel_id      BIGINT NOT NULL REFERENCES channels(id),
    assigned_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    unassigned_at   TIMESTAMPTZ,
    status          VARCHAR(20) NOT NULL DEFAULT 'active',
                    -- active | completed | expired
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_assignments_channel ON assignments(channel_id, assigned_at);
CREATE INDEX idx_assignments_article ON assignments(article_id);
CREATE INDEX idx_assignments_active ON assignments(status) WHERE status = 'active';
```

### revenue_events
```sql
CREATE TABLE revenue_events (
    id              BIGSERIAL PRIMARY KEY,
    channel_id      BIGINT NOT NULL REFERENCES channels(id),
    article_id      BIGINT,  -- NULL if unattributed
    assignment_id   BIGINT REFERENCES assignments(id),
    impressions     INTEGER NOT NULL DEFAULT 0,
    clicks          INTEGER NOT NULL DEFAULT 0,
    revenue         NUMERIC(10, 4) NOT NULL DEFAULT 0,
    period_start    TIMESTAMPTZ NOT NULL,
    period_end      TIMESTAMPTZ NOT NULL,
    pulled_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    attributed      BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE(channel_id, period_start)
);

CREATE INDEX idx_revenue_channel ON revenue_events(channel_id, period_start);
CREATE INDEX idx_revenue_article ON revenue_events(article_id, period_start);
```

### channel_log
```sql
CREATE TABLE channel_log (
    id              BIGSERIAL PRIMARY KEY,
    channel_id      BIGINT NOT NULL REFERENCES channels(id),
    event           VARCHAR(30) NOT NULL,
                    -- assigned | unassigned | idle | disapproved | reactivated
    article_id      BIGINT,
    metadata        JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_channel_log_channel ON channel_log(channel_id, created_at);
```

### Materialized Views
```sql
-- Revenue per article (refreshed every 15 min)
CREATE MATERIALIZED VIEW mv_revenue_per_article AS
SELECT
    a.id AS article_id,
    a.external_id,
    a.url,
    a.category,
    a.published_at,
    a.status AS article_status,
    COALESCE(SUM(r.impressions), 0) AS total_impressions,
    COALESCE(SUM(r.clicks), 0) AS total_clicks,
    COALESCE(SUM(r.revenue), 0) AS total_revenue,
    CASE WHEN SUM(r.impressions) > 0
         THEN (SUM(r.revenue) / SUM(r.impressions)) * 1000
         ELSE 0 END AS rpm
FROM articles a
LEFT JOIN revenue_events r ON r.article_id = a.id
GROUP BY a.id, a.external_id, a.url, a.category, a.published_at, a.status;

CREATE UNIQUE INDEX ON mv_revenue_per_article(article_id);

-- Revenue per channel (refreshed every 15 min)
CREATE MATERIALIZED VIEW mv_revenue_per_channel AS
SELECT
    c.id AS channel_id,
    c.external_id,
    c.status AS channel_status,
    COUNT(DISTINCT r.article_id) AS articles_served,
    COALESCE(SUM(r.impressions), 0) AS total_impressions,
    COALESCE(SUM(r.clicks), 0) AS total_clicks,
    COALESCE(SUM(r.revenue), 0) AS total_revenue
FROM channels c
LEFT JOIN revenue_events r ON r.channel_id = c.id
GROUP BY c.id, c.external_id, c.status;

CREATE UNIQUE INDEX ON mv_revenue_per_channel(channel_id);

-- Refresh command (called by BullMQ job)
-- REFRESH MATERIALIZED VIEW CONCURRENTLY mv_revenue_per_article;
-- REFRESH MATERIALIZED VIEW CONCURRENTLY mv_revenue_per_channel;
```

---

## 06 — BullMQ Job Definitions

```javascript
// All queues use the same Redis connection
const queues = {
  articleAssignment: new Queue('article-assignment'),
  channelState:     new Queue('channel-state'),
  revenueAttribution: new Queue('revenue-attribution'),
  articleExpiry:    new Queue('article-expiry'),
};

// Repeatable jobs (cron-style)
await queues.revenueAttribution.add('pull-afs', {}, {
  repeat: { every: 15 * 60 * 1000 }  // every 15 minutes
});

await queues.articleExpiry.add('check-expiry', {}, {
  repeat: { every: 60 * 60 * 1000 }  // every hour
});

// Event-driven jobs (added when events happen)
// articleAssignment → added when publishing system fires
// channelState → added when channel system detects changes
```

---

## 07 — Monitoring & Alerts

| Alert | Trigger | Channel |
|-------|---------|---------|
| Channel disapproved | Channel status → disapproved | Slack |
| Orphan revenue | Revenue on channel with no active assignment | Slack |
| Queue backlog | >50 articles waiting for assignment | Slack |
| AFS pull failure | Revenue pull fails 2 consecutive times | Slack |
| Idle channel surplus | >30% channels idle for >24h | Slack (daily digest) |
| Expiry worker stall | No expiry check run in >2 hours | Slack |

---

## 08 — Scaling Path (When Needed, Not Now)

If we grow beyond 5,000 channels or 50,000 articles/month:

| Current | Upgrade To | When |
|---------|-----------|------|
| BullMQ (Redis) | Kafka | Event volume exceeds Redis single-thread throughput |
| PostgreSQL analytics | ClickHouse | Dashboard queries slow down (>2s on materialized views) |
| Single Node.js process | Multiple workers | Job processing can't keep up with event rate |
| PostgreSQL revenue_events | TimescaleDB or partition by month | Table exceeds 100M rows |

**Do not pre-optimize.** Add complexity only when measured performance requires it.

---

## 09 — Deployment

### Minimum Infrastructure

| Service | Spec | Estimated Cost |
|---------|------|---------------|
| **Node.js app** | 1 VPS (2 CPU, 4GB RAM) | ~$20/mo |
| **PostgreSQL** | Managed (e.g., Supabase, Neon, RDS) or same VPS | $0–25/mo |
| **Redis** | Managed (e.g., Upstash, ElastiCache) or same VPS | $0–10/mo |
| **Dashboard** | Static deploy (Vercel/Netlify) or same VPS | $0 |

**Total: $20–55/month** to start.

### Environment Variables
```
DATABASE_URL=postgresql://user:pass@host:5432/channel_attribution
REDIS_URL=redis://host:6379
AFS_PUBLISHER_ID=partner-pub-XXXX
AFS_API_KEY=your-afs-reporting-key
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/XXX
```

---

## 10 — Summary

| Metric | Value |
|--------|-------|
| Channels managed | ~2,000 |
| Articles per month | ~10,000 |
| Revenue pull frequency | Every 15 minutes |
| Zero-traffic expiry | Day 3 (72–96h window) |
| Attribution method | Timestamp-based (assignment window) |
| Infrastructure | Redis + PostgreSQL + Node.js |
| Systems removed vs v2 | Kafka, ClickHouse (not needed at scale) |
| Estimated infra cost | $20–55/month |

The system watches channels, assigns them automatically, reclaims dead ones, and tracks every dollar back to the article that earned it. No manual steps. No guesswork.
