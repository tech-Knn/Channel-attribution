-- Migration 010: consolidate v_channel_lifetime + v_article_lifetime
--
-- 009 created two near-identical views: same join, same aggregation, just
-- columns ordered for "channel-first" or "article-first" reading. Cleaner
-- to keep one source of truth and let dashboard queries decide which axis
-- to partition / order by.
--
-- v_assignment_revenue replaces both. Each row = one assignment lifecycle
-- (one channel-article pairing) with its revenue rolled up from
-- revenue_events. Dashboard queries add ROW_NUMBER() OVER (PARTITION BY
-- channel_id …) or (PARTITION BY article_id …) inline.

DROP VIEW IF EXISTS v_channel_lifetime;
DROP VIEW IF EXISTS v_article_lifetime;

CREATE OR REPLACE VIEW v_assignment_revenue AS
SELECT
  asn.id                                                AS assignment_id,
  c.id                                                  AS channel_db_id,
  c.channel_id,
  art.id                                                AS article_db_id,
  art.article_id,
  asn.assigned_at,
  asn.unassigned_at,
  asn.status                                            AS assignment_status,
  asn.pageviews_at_close,
  COALESCE(SUM(re.impressions), 0)::int                 AS impressions,
  COALESCE(SUM(re.clicks),      0)::int                 AS clicks,
  COALESCE(SUM(re.revenue),     0)::numeric(10, 2)      AS revenue
FROM      assignments    asn
JOIN      channels       c   ON c.id   = asn.channel_id
JOIN      articles       art ON art.id = asn.article_id
LEFT JOIN revenue_events re  ON re.assignment_id = asn.id
GROUP BY  asn.id, c.id, c.channel_id,
          art.id, art.article_id,
          asn.assigned_at, asn.unassigned_at, asn.status, asn.pageviews_at_close;

COMMENT ON VIEW v_assignment_revenue IS
  'One row per channel-article assignment with its revenue rolled up. Drives both Revenue-by-Channel (filter on channel_id) and Revenue-by-Article (filter on article_id) dashboard tabs.';
