-- Migration 005: Direct page-view tracking + schema fixes

-- Counter for views recorded by the /api/track/pageview endpoint (no GA4 needed)
ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS direct_pageviews INTEGER NOT NULL DEFAULT 0;

-- Make channel_log.channel_id nullable so lifecycle events (e.g. 'reactivated')
-- can be logged before a new channel is assigned
ALTER TABLE channel_log
  ALTER COLUMN channel_id DROP NOT NULL;
