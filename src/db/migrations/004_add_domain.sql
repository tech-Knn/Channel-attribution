-- ── Migration 004: Add domain support ───────────────────────────────────────
-- Adds domain column to channels and articles for multi-tenant separation.
-- Existing rows default to 'topreserchtopics.com' to preserve current data.

ALTER TABLE channels
    ADD COLUMN IF NOT EXISTS domain VARCHAR(100) NOT NULL DEFAULT 'articlespectrum.com';

ALTER TABLE articles
    ADD COLUMN IF NOT EXISTS domain VARCHAR(100) NOT NULL DEFAULT 'articlespectrum.com';

CREATE INDEX IF NOT EXISTS idx_channels_domain ON channels(domain);
CREATE INDEX IF NOT EXISTS idx_articles_domain ON articles(domain);
