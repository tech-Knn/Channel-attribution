-- ── GA4 Integration Migration ───────────────────────────────────────────────
-- Adds GA traffic monitoring support and removes unused 'stopped' article status.

-- Remove 'stopped' from the articles status set (expiry_reason covers the why)
ALTER TABLE articles
    DROP CONSTRAINT IF EXISTS articles_status_check;

-- Add columns to articles
ALTER TABLE articles
    ADD COLUMN IF NOT EXISTS last_traffic_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS reactivated_at  TIMESTAMPTZ;

-- GA4 metrics per article (one row, upserted each poll cycle)
CREATE TABLE IF NOT EXISTS article_ga_metrics (
    article_id  BIGINT PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE,
    users_ga    INTEGER NOT NULL DEFAULT 0,
    sessions    INTEGER NOT NULL DEFAULT 0,
    pageviews   INTEGER NOT NULL DEFAULT 0,
    checked_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Lifecycle audit trail
CREATE TABLE IF NOT EXISTS article_lifecycle (
    id            BIGSERIAL PRIMARY KEY,
    article_id    BIGINT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    event         VARCHAR(30) NOT NULL,
    triggered_by  VARCHAR(30),
    active_users  INTEGER,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_article_lifecycle_article
    ON article_lifecycle(article_id, created_at DESC);
