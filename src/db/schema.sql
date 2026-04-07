-- ============================================================
-- Channel Attribution System — PostgreSQL Schema
-- Version: 3.0 (matches SOP v3)
-- ============================================================

-- ── users ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    id          BIGSERIAL PRIMARY KEY,
    email       VARCHAR(255) NOT NULL UNIQUE,
    password    TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- ── channels ────────────────────────────────────────────────
CREATE TABLE channels (
    id              BIGINT PRIMARY KEY,
    external_id     VARCHAR(20) NOT NULL UNIQUE,  -- AFS channel ID
    status          VARCHAR(20) NOT NULL DEFAULT 'idle',
                    -- idle | assigned | disapproved | manual_review
    idle_since      TIMESTAMPTZ,
    assigned_to     BIGINT,  -- FK added after articles table exists
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_channels_status ON channels(status);
CREATE INDEX idx_channels_idle_since ON channels(idle_since) WHERE status = 'idle';

-- ── articles ────────────────────────────────────────────────
CREATE TABLE articles (
    id              BIGINT PRIMARY KEY,
    external_id     VARCHAR(100) NOT NULL UNIQUE,  -- CMS article ID
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

-- Now add the FK from channels → articles
ALTER TABLE channels
    ADD CONSTRAINT fk_channels_assigned_to
    FOREIGN KEY (assigned_to) REFERENCES articles(id);

-- ── assignments ─────────────────────────────────────────────
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

-- ── revenue_events ──────────────────────────────────────────
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

-- ── channel_log ─────────────────────────────────────────────
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

-- ── Materialized Views ──────────────────────────────────────

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

-- Idle channel loss estimate (refreshed hourly)
CREATE MATERIALIZED VIEW mv_idle_channel_loss AS
SELECT
    c.id                                          AS channel_id,
    c.external_id,
    c.idle_since,
    EXTRACT(EPOCH FROM (NOW() - c.idle_since))    AS idle_seconds,
    -- Estimate lost revenue: avg RPM of this channel * idle hours
    COALESCE(
        (SELECT SUM(r.revenue) / NULLIF(SUM(r.impressions), 0) * 1000
         FROM revenue_events r WHERE r.channel_id = c.id), 0
    ) * (EXTRACT(EPOCH FROM (NOW() - c.idle_since)) / 3600.0) AS estimated_lost_revenue
FROM channels c
WHERE c.status = 'idle'
  AND c.idle_since IS NOT NULL;

CREATE UNIQUE INDEX ON mv_idle_channel_loss(channel_id);
