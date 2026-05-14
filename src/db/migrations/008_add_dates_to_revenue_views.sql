-- Add last_pulled_at and last_period_end to revenue materialized views

DROP MATERIALIZED VIEW IF EXISTS mv_revenue_per_article CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mv_revenue_per_channel CASCADE;

CREATE MATERIALIZED VIEW mv_revenue_per_article AS
SELECT
  a.id                                       AS db_id,
  a.article_id,
  a.url,
  a.status                                   AS article_status,
  COUNT(DISTINCT r.channel_id)               AS channels_used,
  COALESCE(SUM(r.impressions), 0)::int       AS total_impressions,
  COALESCE(SUM(r.clicks), 0)::int            AS total_clicks,
  COALESCE(SUM(r.revenue), 0)::numeric       AS total_revenue,
  CASE
    WHEN COALESCE(SUM(r.impressions), 0) > 0
      THEN ROUND((SUM(r.revenue) / SUM(r.impressions) * 1000)::numeric, 4)
    ELSE 0
  END                                        AS rpm,
  MAX(r.pulled_at)                           AS last_pulled_at,
  MAX(r.period_end)                          AS last_period_end
FROM articles a
LEFT JOIN revenue_events r ON r.article_id = a.id
GROUP BY a.id, a.article_id, a.url, a.status;

CREATE UNIQUE INDEX ON mv_revenue_per_article (db_id);

CREATE MATERIALIZED VIEW mv_revenue_per_channel AS
SELECT
  c.id                                       AS db_id,
  c.channel_id,
  c.status                                   AS channel_status,
  COUNT(DISTINCT r.article_id)               AS articles_served,
  COALESCE(SUM(r.impressions), 0)::int       AS total_impressions,
  COALESCE(SUM(r.clicks), 0)::int            AS total_clicks,
  COALESCE(SUM(r.revenue), 0)::numeric       AS total_revenue,
  MAX(r.pulled_at)                           AS last_pulled_at,
  MAX(r.period_end)                          AS last_period_end
FROM channels c
LEFT JOIN revenue_events r ON r.channel_id = c.id
GROUP BY c.id, c.channel_id, c.status;

CREATE UNIQUE INDEX ON mv_revenue_per_channel (db_id);
