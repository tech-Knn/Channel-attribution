-- Migration 009: per-assignment revenue attribution
--
-- Problem this fixes:
--   Today revenue_events has UNIQUE(channel_id, period_start). When the
--   worker runs, it looks up "who is currently assigned to this channel"
--   and tags the day's AdSense revenue with that article — even though
--   the revenue may have been earned by an article that has since
--   expired. Past articles get $0 credit, current article inherits other
--   articles' revenue.
--
-- What this migration does (one transaction, idempotent, no data loss):
--   1. Adds assignments.pageviews_at_close (weight for pro-rata split).
--   2. Adds revenue_events.attributed_late (flag for AdSense late reports).
--   3. Creates indexes the new worker needs.
--   4. Backfills pageviews_at_close from articles.direct_pageviews for
--      assignments closed before this fix shipped.
--   5. Backfills revenue_events.assignment_id by joining each historical
--      row to the assignment whose [assigned_at, unassigned_at] window
--      contained the row's period_start. Falls back to "most recent
--      assignment that closed within 24h before period_start" for late
--      revenue. Rows that match neither stay assignment_id IS NULL
--      (orphan) and attributed=false.
--   6. Aligns article_id on each row to the assignment's article so
--      historical mis-attribution from the buggy worker is corrected.
--   7. Swaps the UNIQUE constraint from (channel_id, period_start) to
--      (channel_id, assignment_id, period_start) so multiple assignments
--      on the same channel-day can each hold their share of revenue.
--   8. Creates v_channel_lifetime and v_article_lifetime views — read
--      paths for the dashboard's per-channel and per-article history.
--   9. Refreshes the materialized views so the dashboard reflects the
--      corrected attribution immediately on next deploy.

-- ── 1. Additive columns ─────────────────────────────────────────────────

ALTER TABLE assignments
    ADD COLUMN IF NOT EXISTS pageviews_at_close INTEGER;

ALTER TABLE revenue_events
    ADD COLUMN IF NOT EXISTS attributed_late BOOLEAN NOT NULL DEFAULT FALSE;

-- assignment_id was added on main ahead of this migration; keep the
-- IF NOT EXISTS guard so this is safe to re-run.
ALTER TABLE revenue_events
    ADD COLUMN IF NOT EXISTS assignment_id BIGINT REFERENCES assignments(id);

-- ── 2. Indexes ──────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_revenue_events_assignment
    ON revenue_events(assignment_id);

CREATE INDEX IF NOT EXISTS idx_assignments_channel_window
    ON assignments(channel_id, assigned_at, unassigned_at);

-- ── 3. Backfill pageviews_at_close ──────────────────────────────────────
-- Best-effort approximation for already-closed assignments: use the
-- article's CURRENT direct_pageviews. Not perfect (traffic kept happening
-- on the article on other channels too), but it's the only signal we
-- have for historical rows. New closes (from migration onward) capture
-- the exact value at the moment of close — see queries.js
-- closeAssignmentByArticle.

UPDATE assignments asn
   SET pageviews_at_close = COALESCE(art.direct_pageviews, 0)
  FROM articles art
 WHERE asn.unassigned_at      IS NOT NULL
   AND asn.pageviews_at_close IS NULL
   AND art.id                  = asn.article_id;

-- ── 4. Backfill assignment_id on existing revenue_events ────────────────
-- Strict match: assignment whose [assigned_at, unassigned_at) covers
-- period_start. Late match: most-recently-closed assignment within 24h
-- before period_start (AdSense reports impressions/clicks up to 24-48h
-- after the article expired). Otherwise leave assignment_id NULL.

WITH revenue_match AS (
  SELECT
    re.id AS re_id,
    (
      SELECT asn.id
        FROM assignments asn
       WHERE asn.channel_id   = re.channel_id
         AND asn.assigned_at <= re.period_start
         AND (asn.unassigned_at IS NULL
              OR asn.unassigned_at >= re.period_start)
       ORDER BY asn.assigned_at DESC
       LIMIT 1
    ) AS strict_match,
    (
      SELECT asn.id
        FROM assignments asn
       WHERE asn.channel_id    = re.channel_id
         AND asn.unassigned_at IS NOT NULL
         AND asn.unassigned_at <  re.period_start
         AND asn.unassigned_at >= re.period_start - INTERVAL '24 hours'
       ORDER BY asn.unassigned_at DESC
       LIMIT 1
    ) AS late_match
    FROM revenue_events re
   WHERE re.assignment_id IS NULL
)
UPDATE revenue_events re
   SET assignment_id   = COALESCE(rm.strict_match, rm.late_match),
       attributed_late = (rm.strict_match IS NULL AND rm.late_match IS NOT NULL),
       article_id      = COALESCE(
                           (SELECT article_id
                              FROM assignments
                             WHERE id = COALESCE(rm.strict_match, rm.late_match)),
                           re.article_id
                         ),
       attributed      = (COALESCE(rm.strict_match, rm.late_match) IS NOT NULL)
  FROM revenue_match rm
 WHERE re.id = rm.re_id;

-- ── 5. Swap the UNIQUE constraint ───────────────────────────────────────
-- The old key (channel_id, period_start) collapses all assignments on
-- a channel-day into one row. The new key adds assignment_id so each
-- assignment can hold its own share.

DO $$
DECLARE
  old_key TEXT;
BEGIN
  SELECT conname
    INTO old_key
    FROM pg_constraint c
    JOIN pg_class      t ON t.oid = c.conrelid
   WHERE t.relname = 'revenue_events'
     AND c.contype = 'u'
     AND c.conname = 'revenue_events_channel_id_period_start_key';
  IF old_key IS NOT NULL THEN
    EXECUTE 'ALTER TABLE revenue_events DROP CONSTRAINT ' || quote_ident(old_key);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'revenue_events_uniq_channel_assignment_period'
  ) THEN
    ALTER TABLE revenue_events
      ADD CONSTRAINT revenue_events_uniq_channel_assignment_period
      UNIQUE (channel_id, assignment_id, period_start);
  END IF;
END $$;

-- ── 6. Convenience views ────────────────────────────────────────────────
-- Exactly the shape the dashboard wants: per-channel-per-assignment
-- timeline with revenue rolled up. Use ORDER BY assigned_at to walk
-- the timeline in chronological order.

CREATE OR REPLACE VIEW v_channel_lifetime AS
SELECT
  c.id                                                              AS channel_db_id,
  c.channel_id,
  art.id                                                            AS article_db_id,
  art.article_id,
  asn.id                                                            AS assignment_id,
  ROW_NUMBER() OVER (PARTITION BY c.id ORDER BY asn.assigned_at)    AS assignment_num,
  asn.assigned_at,
  asn.unassigned_at,
  asn.status                                                        AS assignment_status,
  asn.pageviews_at_close,
  COALESCE(SUM(re.impressions), 0)::int                             AS impressions,
  COALESCE(SUM(re.clicks),      0)::int                             AS clicks,
  COALESCE(SUM(re.revenue),     0)::numeric(10, 2)                  AS revenue
FROM      assignments    asn
JOIN      channels       c   ON c.id   = asn.channel_id
JOIN      articles       art ON art.id = asn.article_id
LEFT JOIN revenue_events re  ON re.assignment_id = asn.id
GROUP BY  c.id, c.channel_id,
          art.id, art.article_id,
          asn.id, asn.assigned_at, asn.unassigned_at, asn.status, asn.pageviews_at_close;

CREATE OR REPLACE VIEW v_article_lifetime AS
SELECT
  art.id                                                            AS article_db_id,
  art.article_id,
  c.id                                                              AS channel_db_id,
  c.channel_id,
  asn.id                                                            AS assignment_id,
  asn.assigned_at,
  asn.unassigned_at,
  asn.status                                                        AS assignment_status,
  COALESCE(SUM(re.impressions), 0)::int                             AS impressions,
  COALESCE(SUM(re.clicks),      0)::int                             AS clicks,
  COALESCE(SUM(re.revenue),     0)::numeric(10, 2)                  AS revenue
FROM      assignments    asn
JOIN      channels       c   ON c.id   = asn.channel_id
JOIN      articles       art ON art.id = asn.article_id
LEFT JOIN revenue_events re  ON re.assignment_id = asn.id
GROUP BY  art.id, art.article_id,
          c.id, c.channel_id,
          asn.id, asn.assigned_at, asn.unassigned_at, asn.status;

-- ── 7. Refresh materialized views ───────────────────────────────────────
-- Now that revenue_events.article_id reflects the correct (historical)
-- attribution, the existing summary views will show every article that
-- ever earned revenue — including those whose channels are now idle.
-- Non-concurrent refresh is fine here since we're inside a migration
-- transaction; future refreshes from the worker use CONCURRENTLY.

REFRESH MATERIALIZED VIEW mv_revenue_per_article;
REFRESH MATERIALIZED VIEW mv_revenue_per_channel;
