'use strict';

const { pool } = require('./pool');

// Articles

/**
 * Create a new article.
 */
async function createArticle({ articleId, url, category, status = 'pending', publishedAt, domain = 'articlespectrum.com', callbackUrl = null }) {
  const sql = `
    INSERT INTO articles (article_id, url, category, status, published_at, domain, callback_url)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *`;
  const { rows } = await pool.query(sql, [articleId, url, category, status, publishedAt, domain, callbackUrl]);
  return rows[0];
}

/**
 * Get article by ID.
 */
async function getArticleById(id) {
  const sql = `SELECT * FROM articles WHERE id = $1`;
  const { rows } = await pool.query(sql, [id]);
  return rows[0] || null;
}

/**
 * List articles with optional filters and pagination.
 */
async function listArticles({ status, category, dateFrom, dateTo, limit = 50, offset = 0 } = {}) {
  const conditions = [];
  const params = [];
  let idx = 1;

  if (status) {
    conditions.push(`status = $${idx++}`);
    params.push(status);
  }
  if (category) {
    conditions.push(`category = $${idx++}`);
    params.push(category);
  }
  if (dateFrom) {
    conditions.push(`published_at >= $${idx++}`);
    params.push(dateFrom);
  }
  if (dateTo) {
    conditions.push(`published_at <= $${idx++}`);
    params.push(dateTo);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  // Sort by most recent activity — newer of published_at or reactivated_at.
  // Otherwise a recently-reactivated article (originally published weeks ago)
  // would stay at the bottom of the list and the user can't see that the
  // pageview-threshold reactivation actually fired.
  const sql = `
    SELECT * FROM articles ${where}
    ORDER BY GREATEST(published_at, COALESCE(reactivated_at, '-infinity'::timestamptz)) DESC
    LIMIT $${idx++} OFFSET $${idx++}`;
  params.push(limit, offset);

  const { rows } = await pool.query(sql, params);

  const countSql = `SELECT COUNT(*)::int AS total FROM articles ${where}`;
  const { rows: countRows } = await pool.query(countSql, params.slice(0, params.length - 2));
  const total = countRows[0].total;

  return { data: rows, total, limit, offset };
}

/**
 * Update article status.
 */
async function updateArticleStatus(id, status, extra = {}, client = null) {
  const db = client || pool;
  const sets = ['status = $2'];
  const params = [id, status];
  let idx = 3;

  if (extra.expiredAt) {
    sets.push(`expired_at = $${idx++}`);
    params.push(extra.expiredAt);
  }
  if (extra.expiryReason) {
    sets.push(`expiry_reason = $${idx++}`);
    params.push(extra.expiryReason);
  }
  // Always set last_traffic_at when assigning so the expiry clock starts fresh
  if (status === 'assigned') {
    sets.push(`last_traffic_at = $${idx++}`);
    params.push(extra.lastTrafficAt || new Date());
  } else if (extra.lastTrafficAt) {
    sets.push(`last_traffic_at = $${idx++}`);
    params.push(extra.lastTrafficAt);
  }

  const sql = `UPDATE articles SET ${sets.join(', ')} WHERE id = $1 RETURNING *`;
  const { rows } = await db.query(sql, params);
  return rows[0] || null;
}

// -- Channels -----------------------------------------------------------------

/**
 * Create a new channel.
 */
async function createChannel({ id, channelId, status = 'idle', domain = 'articlespectrum.com' }) {
  const sql = `
    INSERT INTO channels (id, channel_id, status, idle_since, domain)
    VALUES ($1, $2, $3, NOW(), $4)
    RETURNING *`;
  const { rows } = await pool.query(sql, [id, channelId, status, domain]);
  return rows[0];
}

/**
 * Get channel by ID with current assignment info.
 */
async function getChannelById(id) {
  const sql = `
    SELECT c.*,
           a.id AS current_assignment_id,
           a.article_id AS current_article_id,
           art.article_id AS current_article_ref
    FROM channels c
    LEFT JOIN assignments a ON a.channel_id = c.id AND a.status = 'active'
    LEFT JOIN articles art ON art.id = a.article_id
    WHERE c.id = $1`;
  const { rows } = await pool.query(sql, [id]);
  return rows[0] || null;
}

/**
 * List channels with optional status filter and pagination.
 */
async function listChannels({ status, limit = 50, offset = 0 } = {}) {
  const conditions = [];
  const params = [];
  let idx = 1;

  if (status) {
    conditions.push(`status = $${idx++}`);
    params.push(status);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const sql = `
    SELECT * FROM channels ${where}
    ORDER BY created_at DESC
    LIMIT $${idx++} OFFSET $${idx++}`;
  params.push(limit, offset);

  const { rows } = await pool.query(sql, params);

  const countSql = `SELECT COUNT(*)::int AS total FROM channels ${where}`;
  const { rows: countRows } = await pool.query(countSql, params.slice(0, params.length - 2));
  const total = countRows[0].total;

  return { data: rows, total, limit, offset };
}

/**
 * Update channel status and optional fields.
 */
async function updateChannelStatus(id, status, extra = {}, client = null) {
  const db = client || pool;
  const sets = ['status = $2', 'updated_at = NOW()'];
  const params = [id, status];
  let idx = 3;

  if (status === 'idle' && extra.assignedTo === undefined && !extra.idleSince) {
    sets.push(`idle_since = NOW()`);
    sets.push(`assigned_to = NULL`);
  }
  if (extra.assignedTo !== undefined) {
    sets.push(`assigned_to = $${idx++}`);
    params.push(extra.assignedTo);
  }
  if (extra.idleSince) {
    sets.push(`idle_since = $${idx++}`);
    params.push(extra.idleSince);
  }

  const sql = `UPDATE channels SET ${sets.join(', ')} WHERE id = $1 RETURNING *`;
  const { rows } = await db.query(sql, params);
  return rows[0] || null;
}

/**
 * Get assignment history for a channel.
 */
async function getChannelAssignmentHistory(channelId, limit = 20) {
  const sql = `
    SELECT a.*, art.article_id AS article_id, art.url AS article_url
    FROM assignments a
    JOIN articles art ON art.id = a.article_id
    WHERE a.channel_id = $1
    ORDER BY a.assigned_at DESC
    LIMIT $2`;
  const { rows } = await pool.query(sql, [channelId, limit]);
  return rows;
}

// Assignments

/**
 * Create a new assignment.
 */
async function createAssignment({ articleId, channelId }, client = null) {
  const db = client || pool;
  const sql = `
    INSERT INTO assignments (article_id, channel_id, assigned_at, status)
    VALUES ($1, $2, NOW(), 'active')
    RETURNING *`;
  const { rows } = await db.query(sql, [articleId, channelId]);
  return rows[0];
}

/**
 * Close an assignment.
 */
async function closeAssignment(id, status = 'completed') {
  const sql = `
    UPDATE assignments SET unassigned_at = NOW(), status = $2
    WHERE id = $1 RETURNING *`;
  const { rows } = await pool.query(sql, [id, status]);
  return rows[0] || null;
}

/**
 * Get active assignment for a channel.
 */
async function getActiveAssignmentForChannel(channelId) {
  const sql = `SELECT * FROM assignments WHERE channel_id = $1 AND status = 'active' LIMIT 1`;
  const { rows } = await pool.query(sql, [channelId]);
  return rows[0] || null;
}

/**
 * Get active assignment for an article.
 */
async function getActiveAssignmentForArticle(articleId) {
  const sql = `SELECT * FROM assignments WHERE article_id = $1 AND status = 'active' LIMIT 1`;
  const { rows } = await pool.query(sql, [articleId]);
  return rows[0] || null;
}

/**
 * List all active assignments.
 */
async function listActiveAssignments() {
  const sql = `
    SELECT a.*,
           art.article_id AS article_id,
           art.url AS article_url,
           art.last_traffic_at,
           c.channel_id AS channel_id
    FROM assignments a
    JOIN articles art ON art.id = a.article_id
    JOIN channels c ON c.id = a.channel_id
    WHERE a.status = 'active'
    ORDER BY a.assigned_at DESC`;
  const { rows } = await pool.query(sql);
  return rows;
}

/**
 * List assignments with filters and pagination.
 */
async function listAssignments({ status, limit = 50, offset = 0 } = {}) {
  const conditions = [];
  const params = [];
  let idx = 1;

  if (status) {
    conditions.push(`a.status = $${idx++}`);
    params.push(status);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const sql = `
    SELECT a.*,
           art.article_id AS article_id,
           art.url AS article_url,
           c.channel_id AS channel_id
    FROM assignments a
    JOIN articles art ON art.id = a.article_id
    JOIN channels c ON c.id = a.channel_id
    ${where}
    ORDER BY a.assigned_at DESC
    LIMIT $${idx++} OFFSET $${idx++}`;
  params.push(limit, offset);

  const { rows } = await pool.query(sql, params);

  const countSql = `SELECT COUNT(*)::int AS total FROM assignments a ${where}`;
  const { rows: countRows } = await pool.query(countSql, params.slice(0, params.length - 2));
  const total = countRows[0].total;

  return { data: rows, total, limit, offset };
}


// Revenue


/**
 * Get revenue summary — today, 7 days, 30 days.
 */
/**
 * Get revenue summary — today, 7 days, 30 days.
 * Optional domain filter.
 */
/**
 * Get revenue summary.
 *
 * @param {Object} opts
 * @param {string} [opts.from] — ISO date 'YYYY-MM-DD' (inclusive)
 * @param {string} [opts.to]   — ISO date 'YYYY-MM-DD' (inclusive)
 *
 * If from/to provided: returns aggregated metrics for that range.
 * If not: returns today/7d/30d hardcoded windows (legacy behavior).
 */
async function getRevenueSummary({ from, to } = {}) {
  if (from && to) {
    const sql = `
      SELECT
        COALESCE(SUM(revenue), 0)::numeric    AS revenue_range,
        COALESCE(SUM(impressions), 0)::int    AS impressions_range,
        COALESCE(SUM(clicks), 0)::int         AS clicks_range,
        MAX(pulled_at)                        AS last_pulled_at
      FROM revenue_events
      WHERE period_start >= $1::date
        AND period_start < ($2::date + INTERVAL '1 day')`;
    const { rows } = await pool.query(sql, [from, to]);
    return { ...rows[0], range: { from, to } };
  }

  // Legacy behavior — today / 7d / 30d
  const sql = `
    SELECT
      COALESCE(SUM(CASE WHEN period_start >= NOW() - INTERVAL '1 day'  THEN revenue     ELSE 0 END), 0)::numeric AS revenue_today,
      COALESCE(SUM(CASE WHEN period_start >= NOW() - INTERVAL '1 day'  THEN impressions ELSE 0 END), 0)::int     AS impressions_today,
      COALESCE(SUM(CASE WHEN period_start >= NOW() - INTERVAL '1 day'  THEN clicks      ELSE 0 END), 0)::int     AS clicks_today,
      COALESCE(SUM(CASE WHEN period_start >= NOW() - INTERVAL '7 days' THEN revenue     ELSE 0 END), 0)::numeric AS revenue_7d,
      COALESCE(SUM(CASE WHEN period_start >= NOW() - INTERVAL '7 days' THEN impressions ELSE 0 END), 0)::int     AS impressions_7d,
      COALESCE(SUM(CASE WHEN period_start >= NOW() - INTERVAL '7 days' THEN clicks      ELSE 0 END), 0)::int     AS clicks_7d,
      COALESCE(SUM(CASE WHEN period_start >= NOW() - INTERVAL '30 days' THEN revenue     ELSE 0 END), 0)::numeric AS revenue_30d,
      COALESCE(SUM(CASE WHEN period_start >= NOW() - INTERVAL '30 days' THEN impressions ELSE 0 END), 0)::int     AS impressions_30d,
      COALESCE(SUM(CASE WHEN period_start >= NOW() - INTERVAL '30 days' THEN clicks      ELSE 0 END), 0)::int     AS clicks_30d
    FROM revenue_events`;
  const { rows } = await pool.query(sql);
  return rows[0];
}

/**
 * Revenue per article from materialized view.
 */
async function getRevenueByArticle({ limit = 50, offset = 0, sortBy = 'total_revenue', sortDir = 'DESC', from, to } = {}) {
  const allowedSorts = ['total_revenue', 'total_impressions', 'total_clicks', 'rpm', 'published_at'];
  const sort = allowedSorts.includes(sortBy) ? sortBy : 'total_revenue';
  const dir = sortDir.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

  // No date filter → use materialized view (Option Y, fast path)
  if (!from || !to) {
    const sql = `
      SELECT mv.*, a.status AS article_status
      FROM mv_revenue_per_article mv
      JOIN articles a ON a.article_id = mv.article_id
      ORDER BY mv.${sort} ${dir}
      LIMIT $1 OFFSET $2`;
    const { rows } = await pool.query(sql, [limit, offset]);
    const { rows: countRows } = await pool.query(`SELECT COUNT(*)::int AS total FROM mv_revenue_per_article`);
    return { data: rows, total: countRows[0].total, limit, offset };
  }

  // Date filter → query revenue_events directly, aggregate per article
  const sql = `
    SELECT
      a.id AS db_id,
      a.article_id,
      a.url,
      a.category,
      a.published_at,
      a.status AS article_status,
      COALESCE(SUM(r.impressions), 0) AS total_impressions,
      COALESCE(SUM(r.clicks), 0) AS total_clicks,
      COALESCE(SUM(r.revenue), 0) AS total_revenue,
      CASE WHEN SUM(r.impressions) > 0
           THEN (SUM(r.revenue) / SUM(r.impressions)) * 1000
           ELSE 0 END AS rpm,
      MAX(r.pulled_at) AS last_pulled_at,
      MAX(r.period_end) AS last_period_end
    FROM articles a
    LEFT JOIN revenue_events r
      ON r.article_id = a.id
     AND r.period_start >= $1::date
     AND r.period_start < ($2::date + INTERVAL '1 day')
    GROUP BY a.id, a.article_id, a.url, a.category, a.published_at, a.status
    ORDER BY ${sort} ${dir}
    LIMIT $3 OFFSET $4`;
  const { rows } = await pool.query(sql, [from, to, limit, offset]);

  const { rows: countRows } = await pool.query(`SELECT COUNT(*)::int AS total FROM articles`);
  return { data: rows, total: countRows[0].total, limit, offset };
}

/**
 * Revenue per channel from materialized view.
 */
async function getRevenueByChannel({ limit = 50, offset = 0, sortBy = 'total_revenue', sortDir = 'DESC', from, to } = {}) {
  const allowedSorts = ['total_revenue', 'total_impressions', 'total_clicks', 'articles_served'];
  const sort = allowedSorts.includes(sortBy) ? sortBy : 'total_revenue';
  const dir = sortDir.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

  if (!from || !to) {
    const sql = `
      SELECT * FROM mv_revenue_per_channel
      ORDER BY ${sort} ${dir}
      LIMIT $1 OFFSET $2`;
    const { rows } = await pool.query(sql, [limit, offset]);
    const { rows: countRows } = await pool.query(`SELECT COUNT(*)::int AS total FROM mv_revenue_per_channel`);
    return { data: rows, total: countRows[0].total, limit, offset };
  }

  const sql = `
    SELECT
      c.id AS db_id,
      c.channel_id,
      c.status AS channel_status,
      COUNT(DISTINCT r.article_id) AS articles_served,
      COALESCE(SUM(r.impressions), 0) AS total_impressions,
      COALESCE(SUM(r.clicks), 0) AS total_clicks,
      COALESCE(SUM(r.revenue), 0) AS total_revenue,
      MAX(r.pulled_at) AS last_pulled_at,
      MAX(r.period_end) AS last_period_end
    FROM channels c
    LEFT JOIN revenue_events r
      ON r.channel_id = c.id
     AND r.period_start >= $1::date
     AND r.period_start < ($2::date + INTERVAL '1 day')
    GROUP BY c.id, c.channel_id, c.status
    ORDER BY ${sort} ${dir}
    LIMIT $3 OFFSET $4`;
  const { rows } = await pool.query(sql, [from, to, limit, offset]);

  const { rows: countRows } = await pool.query(`SELECT COUNT(*)::int AS total FROM channels`);
  return { data: rows, total: countRows[0].total, limit, offset };
}

/**
 * Get unattributed revenue (revenue with no article assignment).
 */
async function getUnattributedRevenue({ limit = 50, offset = 0, from, to } = {}) {
  const params = [];
  let dateFilter = '';
  let idx = 1;
  if (from && to) {
    dateFilter = `AND r.period_start >= $${idx++}::date AND r.period_start < ($${idx++}::date + INTERVAL '1 day')`;
    params.push(from, to);
  }

  const sql = `
    SELECT r.*, c.channel_id AS channel_id
    FROM revenue_events r
    JOIN channels c ON c.id = r.channel_id
    WHERE (r.attributed = FALSE OR r.article_id IS NULL)
      ${dateFilter}
    ORDER BY r.period_start DESC
    LIMIT $${idx++} OFFSET $${idx++}`;
  params.push(limit, offset);

  const { rows } = await pool.query(sql, params);

  const countSql = `
    SELECT COUNT(*)::int AS total FROM revenue_events r
    WHERE (r.attributed = FALSE OR r.article_id IS NULL)
      ${dateFilter}`;
  const countParams = from && to ? [from, to] : [];
  const { rows: countRows } = await pool.query(countSql, countParams);
  return { data: rows, total: countRows[0].total, limit, offset };
}

/**
 * Get revenue breakdown for a specific article.
 */
async function getArticleRevenue(articleId) {
  const sql = `
    SELECT r.*, c.channel_id AS channel_id
    FROM revenue_events r
    JOIN channels c ON c.id = r.channel_id
    WHERE r.article_id = $1
    ORDER BY r.period_start DESC`;
  const { rows } = await pool.query(sql, [articleId]);

  // Summary
  const sumSql = `
    SELECT
      COALESCE(SUM(impressions), 0)::int AS total_impressions,
      COALESCE(SUM(clicks), 0)::int AS total_clicks,
      COALESCE(SUM(revenue), 0)::numeric AS total_revenue,
      CASE WHEN SUM(impressions) > 0
           THEN (SUM(revenue) / SUM(impressions)) * 1000
           ELSE 0 END AS rpm
    FROM revenue_events WHERE article_id = $1`;
  const { rows: sumRows } = await pool.query(sumSql, [articleId]);
  return { events: rows, summary: sumRows[0] };
}

/**
 * Refresh materialized views.
 */
async function refreshMaterializedViews() {
  await pool.query('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_revenue_per_article');
  await pool.query('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_revenue_per_channel');
  return { refreshed: true, at: new Date().toISOString() };
}

/**
 * Refresh idle channel loss materialized view (called hourly).
 */
async function refreshIdleLossView() {
  await pool.query('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_idle_channel_loss');
  return { refreshed: true, at: new Date().toISOString() };
}

/**
 * Get idle channel loss estimates from materialized view.
 */
async function getIdleChannelLoss({ limit = 50, offset = 0 } = {}) {
  const sql = `
    SELECT * FROM mv_idle_channel_loss
    ORDER BY estimated_lost_revenue DESC
    LIMIT $1 OFFSET $2`;
  const { rows } = await pool.query(sql, [limit, offset]);

  const { rows: countRows } = await pool.query(
    'SELECT COUNT(*)::int AS total FROM mv_idle_channel_loss',
  );

  return { data: rows, total: countRows[0].total, limit, offset };
}

// -- Dashboard ----------------------------------------------------------------

/**
 * Get counts for dashboard summary cards.
 */
async function getDashboardStats() {
  const sql = `
    SELECT
      (SELECT COUNT(*)::int FROM channels WHERE status = 'assigned') AS active_channels,
      (SELECT COUNT(*)::int FROM channels WHERE status = 'idle') AS idle_channels,
      (SELECT COUNT(*)::int FROM channels WHERE status = 'disapproved') AS disapproved_channels,
      (SELECT COUNT(*)::int FROM articles WHERE status = 'assigned' OR status = 'active') AS assigned_articles,
      (SELECT COUNT(*)::int FROM assignments WHERE status = 'active') AS active_assignments,
      (SELECT COALESCE(SUM(revenue), 0)::numeric FROM revenue_events WHERE period_start >= NOW() - INTERVAL '1 day') AS revenue_today`;
  const { rows } = await pool.query(sql);
  return rows[0];
}

/**
 * Get recent alerts — expiries, orphan revenue, disapprovals.
 */
async function getRecentAlerts(limit = 50) {
  const sql = `
    (
      SELECT 'expiry' AS alert_type,
             a.id AS entity_id,
             a.article_id AS entity_name,
             a.expired_at AS occurred_at,
             jsonb_build_object('reason', a.expiry_reason) AS details
      FROM articles a
      WHERE a.status = 'expired'
      ORDER BY a.expired_at DESC
      LIMIT $1
    )
    UNION ALL
    (
      SELECT 'orphan_revenue' AS alert_type,
             r.id AS entity_id,
             c.channel_id AS entity_name,
             r.pulled_at AS occurred_at,
             jsonb_build_object('revenue', r.revenue, 'channel_id', r.channel_id) AS details
      FROM revenue_events r
      JOIN channels c ON c.id = r.channel_id
      WHERE r.article_id IS NULL
      ORDER BY r.pulled_at DESC
      LIMIT $1
    )
    UNION ALL
    (
      SELECT 'disapproval' AS alert_type,
             cl.channel_id AS entity_id,
             c.channel_id AS entity_name,
             cl.created_at AS occurred_at,
             cl.metadata AS details
      FROM channel_log cl
      JOIN channels c ON c.id = cl.channel_id
      WHERE cl.event = 'disapproved'
      ORDER BY cl.created_at DESC
      LIMIT $1
    )
    ORDER BY occurred_at DESC
    LIMIT $1`;
  const { rows } = await pool.query(sql, [limit]);
  return rows;
}

// -- Channel Log --------------------------------------------------------------

/**
 * Add a channel log entry.
 */
async function addChannelLog(channelId, event, articleId = null, metadata = null, client = null) {
  const db = client || pool;
  const sql = `
    INSERT INTO channel_log (channel_id, event, article_id, metadata)
    VALUES ($1, $2, $3, $4)
    RETURNING *`;
  const { rows } = await db.query(sql, [channelId, event, articleId, metadata ? JSON.stringify(metadata) : null]);
  return rows[0];
}

// -- Workers ------------------------------------------------------------------

async function getZeroTrafficArticles(zeroTrafficMinutes = 5) {
  const sql = `
    SELECT a.*
    FROM articles a
    WHERE a.status IN ('assigned', 'active')
      AND (
        (a.last_traffic_at IS NOT NULL AND a.last_traffic_at <= NOW() - ($1 * INTERVAL '1 minute'))
        OR
        (a.last_traffic_at IS NULL AND a.created_at <= NOW() - ($1 * INTERVAL '1 minute'))
      )`;
  const { rows } = await pool.query(sql, [zeroTrafficMinutes]);
  return rows;
}

async function getZeroRevenueArticles(hoursMin = 72, hoursMax = 96) {
  const sql = `
    SELECT a.*
    FROM articles a
    LEFT JOIN revenue_events r ON r.article_id = a.id
    WHERE a.status IN ('assigned', 'active')
      AND a.published_at <= NOW() - INTERVAL '${hoursMin} hours'
      AND a.published_at >= NOW() - INTERVAL '${hoursMax} hours'
      AND (a.last_traffic_at IS NULL OR a.last_traffic_at < NOW() - INTERVAL '24 hours')
    GROUP BY a.id
    HAVING COALESCE(SUM(r.impressions), 0) = 0 AND COALESCE(SUM(r.clicks), 0) = 0`;
  const { rows } = await pool.query(sql);
  return rows;
}

/**
 * Close assignment by article ID (find active assignment for article and close it).
 */
async function closeAssignmentByArticle(articleId, status = 'expired', client = null) {
  const db = client || pool;
  // Snapshot articles.direct_pageviews into assignments.pageviews_at_close.
  // The revenueAttribution worker uses it as the weight for pro-rata
  // splitting daily revenue between assignments that shared a channel-day.
  const sql = `
    UPDATE assignments asn
       SET unassigned_at      = NOW(),
           status             = $2,
           pageviews_at_close = COALESCE(art.direct_pageviews, 0)
      FROM articles art
     WHERE asn.article_id = $1
       AND asn.status     = 'active'
       AND art.id         = asn.article_id
    RETURNING asn.*`;
  const { rows } = await db.query(sql, [articleId, status]);
  return rows[0] || null;
}

/**
 * Upsert a revenue event.
 *
 * Unique key after migration 009 is (channel_id, assignment_id, period_start).
 * Rows with assignment_id IS NULL are orphan revenue (channel had no assignment
 * during the period) and Postgres treats each NULL as distinct, so orphan
 * rows can repeat across pulls without colliding.
 */
async function upsertRevenueEvent({
  channelId, articleId, assignmentId,
  impressions, clicks, revenue,
  periodStart, periodEnd,
  attributed = true, attributedLate = false,
}) {
  const sql = `
    INSERT INTO revenue_events
        (channel_id, article_id, assignment_id, impressions, clicks, revenue,
         period_start, period_end, attributed, attributed_late)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    ON CONFLICT (channel_id, assignment_id, period_start)
    DO UPDATE SET
      article_id      = EXCLUDED.article_id,
      impressions     = EXCLUDED.impressions,
      clicks          = EXCLUDED.clicks,
      revenue         = EXCLUDED.revenue,
      period_end      = EXCLUDED.period_end,
      attributed      = EXCLUDED.attributed,
      attributed_late = EXCLUDED.attributed_late,
      pulled_at       = NOW()
    RETURNING *`;
  const { rows } = await pool.query(sql, [
    channelId, articleId, assignmentId,
    impressions, clicks, revenue,
    periodStart, periodEnd,
    attributed, attributedLate,
  ]);
  return rows[0];
}

/**
 * Per-assignment revenue timeline — drives the dashboard's "Timeline" tab.
 *
 * Returns one row per (channel, article, assignment_lifecycle) with
 * revenue/impressions/clicks summed. Read from the v_assignment_revenue
 * view created in migration 010.
 *
 * Filters (all optional):
 *   channelId / articleId          — exact external id match
 *   status                         — 'active' | 'expired' | 'completed'
 *   from / to                      — by assigned_at
 *   hideZero                       — default true: skip rows where revenue=0
 *   sortBy: 'revenue' | 'assigned_at' | 'impressions' | 'clicks'
 *   sortDir: 'ASC' | 'DESC'
 */
async function getAssignmentRevenue({
  channelId, articleId, status,
  from, to,
  hideZero = true,
  limit = 50, offset = 0,
  sortBy = 'assigned_at', sortDir = 'DESC',
} = {}) {
  const conditions = [];
  const params = [];
  let idx = 1;

  if (channelId)  { conditions.push(`channel_id = $${idx++}`); params.push(String(channelId)); }
  if (articleId)  { conditions.push(`article_id = $${idx++}`); params.push(String(articleId)); }
  if (status)     { conditions.push(`assignment_status = $${idx++}`); params.push(status); }
  if (from)       { conditions.push(`assigned_at >= $${idx++}`); params.push(from); }
  if (to)         { conditions.push(`assigned_at < $${idx++}`); params.push(to); }
  // hideZero only hides CLOSED assignments with no revenue. An active
  // assignment that hasn't earned yet (newly reactivated, just-published)
  // is meaningful state and must always be visible.
  if (hideZero)   { conditions.push(`(revenue > 0 OR assignment_status = 'active')`); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const allowedSort = ['revenue', 'assigned_at', 'unassigned_at', 'impressions', 'clicks'];
  const sort = allowedSort.includes(sortBy) ? sortBy : 'assigned_at';
  const dir  = sortDir?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

  const dataSql = `
    SELECT assignment_id, channel_id, article_id,
           assigned_at, unassigned_at, assignment_status,
           impressions, clicks, revenue
      FROM v_assignment_revenue
      ${where}
      ORDER BY ${sort} ${dir} NULLS LAST, assignment_id DESC
      LIMIT $${idx++} OFFSET $${idx++}`;
  params.push(limit, offset);

  const { rows } = await pool.query(dataSql, params);

  const countSql = `SELECT COUNT(*)::int AS total FROM v_assignment_revenue ${where}`;
  const { rows: countRows } = await pool.query(countSql, params.slice(0, params.length - 2));

  return { data: rows, total: countRows[0].total, limit, offset };
}

/**
 * Return every assignment on this channel whose lifetime overlaps
 * [periodStart, periodEnd]. Used by the revenue worker to find all
 * articles that held the channel during a given AdSense reporting day.
 *
 * Overlap test:
 *   asn.assigned_at < periodEnd
 *   AND COALESCE(asn.unassigned_at, NOW()) > periodStart
 *
 * Returns assignments ordered by assigned_at ASC so callers can apply
 * weights in chronological order.
 */
async function getAssignmentsOverlapping(channelDbId, periodStart, periodEnd) {
  const sql = `
    SELECT asn.id,
           asn.article_id,
           asn.channel_id,
           asn.assigned_at,
           asn.unassigned_at,
           asn.status,
           asn.pageviews_at_close,
           art.direct_pageviews    AS article_pageviews_now,
           art.article_id          AS article_ref
      FROM assignments asn
      JOIN articles    art ON art.id = asn.article_id
     WHERE asn.channel_id = $1
       AND asn.assigned_at < $3
       AND COALESCE(asn.unassigned_at, NOW()) > $2
     ORDER BY asn.assigned_at ASC`;
  const { rows } = await pool.query(sql, [channelDbId, periodStart, periodEnd]);
  return rows;
}

/**
 * For a channel that has no active assignment but AdSense reports revenue:
 * find the most-recently-closed assignment within `withinMs` (default 24h)
 * before the period end. AdSense often reports impressions/clicks 24-48h
 * after an article has expired — this captures the tail end of that revenue.
 */
async function getRecentlyClosedAssignment(channelDbId, referenceTs, withinMs = 24 * 60 * 60 * 1000) {
  const sql = `
    SELECT asn.id,
           asn.article_id,
           asn.channel_id,
           asn.assigned_at,
           asn.unassigned_at,
           asn.pageviews_at_close,
           art.article_id          AS article_ref
      FROM assignments asn
      JOIN articles    art ON art.id = asn.article_id
     WHERE asn.channel_id    = $1
       AND asn.unassigned_at IS NOT NULL
       AND asn.unassigned_at <= $2::timestamptz
       AND asn.unassigned_at >= ($2::timestamptz - ($3 || ' milliseconds')::interval)
     ORDER BY asn.unassigned_at DESC
     LIMIT 1`;
  const { rows } = await pool.query(sql, [channelDbId, referenceTs, String(withinMs)]);
  return rows[0] || null;
}

// Aliases for worker compatibility
const logChannelEvent = addChannelLog;
const getActiveAssignmentByChannel = getActiveAssignmentForChannel;

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

/**
 * Get per-pull revenue events with filters.
 * Each row is one 15-min AdSense pull window.
 *
 * @param {Object} opts
 * @param {string} [opts.domain]  — filter by channel.domain OR article.domain
 * @param {Date}   [opts.from]    — start of date range (default: 30 days ago)
 * @param {Date}   [opts.to]      — end of date range (default: now)
 * @param {number} [opts.limit]   — default 100, max 500
 * @param {number} [opts.offset]  — default 0
 */
async function getRevenueTimeline({ domain, from, to, limit = 100, offset = 0 } = {}) {
  const dateFrom = from ? new Date(from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const dateTo   = to   ? new Date(to)   : new Date();
  const safeLimit  = Math.min(parseInt(limit, 10) || 100, 500);
  const safeOffset = parseInt(offset, 10) || 0;

  const conditions = ['r.period_start BETWEEN $1 AND $2'];
  const params = [dateFrom, dateTo];

  if (domain) {
    conditions.push(`(c.domain = $3 OR a.domain = $3)`);
    params.push(domain);
  }

  const where = conditions.join(' AND ');

  const sql = `
    SELECT
      r.id,
      r.period_start,
      r.period_end,
      r.pulled_at,
      r.impressions,
      r.clicks,
      r.revenue,
      r.attributed,
      c.channel_id,
      c.domain      AS channel_domain,
      c.status      AS channel_status,
      a.article_id,
      a.url         AS article_url,
      a.domain      AS article_domain,
      a.status      AS article_status,
      a.category    AS article_category
    FROM revenue_events r
    LEFT JOIN channels c ON c.id = r.channel_id
    LEFT JOIN articles a ON a.id = r.article_id
    WHERE ${where}
    ORDER BY r.period_start DESC
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;

  const dataParams = [...params, safeLimit, safeOffset];
  const { rows } = await pool.query(sql, dataParams);

  // Count total matching rows (for pagination)
  const countSql = `
    SELECT COUNT(*)::int AS total
    FROM revenue_events r
    LEFT JOIN channels c ON c.id = r.channel_id
    LEFT JOIN articles a ON a.id = r.article_id
    WHERE ${where}`;
  const { rows: countRows } = await pool.query(countSql, params);

  return {
    data: rows,
    total: countRows[0].total,
    limit: safeLimit,
    offset: safeOffset,
    range: { from: dateFrom.toISOString(), to: dateTo.toISOString() },
    filter: { domain: domain || null },
  };
}


/**
 * Get list of all domains with channel and article counts.
 * For frontend dropdown of available domains.
 */
async function getDomains() {
  const sql = `
    WITH channel_domains AS (
      SELECT domain, COUNT(*)::int AS channels_count
      FROM channels
      GROUP BY domain
    ),
    article_domains AS (
      SELECT domain, COUNT(*)::int AS articles_count
      FROM articles
      GROUP BY domain
    ),
    revenue_domains AS (
      SELECT
        COALESCE(c.domain, a.domain) AS domain,
        COALESCE(SUM(r.revenue), 0)::numeric AS total_revenue,
        COALESCE(SUM(r.impressions), 0)::int AS total_impressions,
        COALESCE(SUM(r.clicks), 0)::int AS total_clicks
      FROM revenue_events r
      LEFT JOIN channels c ON c.id = r.channel_id
      LEFT JOIN articles a ON a.id = r.article_id
      GROUP BY COALESCE(c.domain, a.domain)
    )
    SELECT
      d.domain,
      COALESCE(cd.channels_count, 0) AS channels_count,
      COALESCE(ad.articles_count, 0) AS articles_count,
      COALESCE(rd.total_revenue, 0)::numeric AS total_revenue,
      COALESCE(rd.total_impressions, 0)::int AS total_impressions,
      COALESCE(rd.total_clicks, 0)::int AS total_clicks
    FROM (
      SELECT domain FROM channel_domains
      UNION
      SELECT domain FROM article_domains
    ) d
    LEFT JOIN channel_domains cd ON cd.domain = d.domain
    LEFT JOIN article_domains ad ON ad.domain = d.domain
    LEFT JOIN revenue_domains rd ON rd.domain = d.domain
    WHERE d.domain IS NOT NULL
    ORDER BY total_revenue DESC, d.domain ASC`;

  const { rows } = await pool.query(sql);
  return rows;
}

module.exports = {
  // Articles
  createArticle,
  getArticleById,
  listArticles,
  updateArticleStatus,
  getArticleRevenue,      

  // Channels
  createChannel,
  getChannelById,
  listChannels,
  updateChannelStatus,
  getChannelAssignmentHistory,

  // Assignments
  createAssignment,
  closeAssignment,
  getActiveAssignmentForChannel,
  getActiveAssignmentForArticle,
  listActiveAssignments,
  listAssignments,

  // Revenue
  // Revenue
  getRevenueSummary,
  getRevenueByArticle,
  getRevenueByChannel,
  getUnattributedRevenue,
  refreshMaterializedViews,
  refreshIdleLossView,
  getIdleChannelLoss,
  getRevenueTimeline,   // ← add
  getDomains,           // ← add

  // Dashboard
  getDashboardStats,
  getRecentAlerts,

  // Logging
  addChannelLog,

  // Worker aliases & additions
  logChannelEvent,
  getActiveAssignmentByChannel,
  getZeroTrafficArticles,
  getZeroRevenueArticles,
  closeAssignmentByArticle,
  upsertRevenueEvent,
  getAssignmentsOverlapping,
  getRecentlyClosedAssignment,
  getAssignmentRevenue,

  // GA4 monitoring
  getArticlesForGaMonitor,
  getExpiredArticlesForReactivation,
  getActiveArticlesWithUrl,
  upsertArticleGaMetrics,
  reactivateArticle,
  addArticleLifecycleEvent,
  updateArticleLastTrafficAt,
  getArticleGaMetrics,
  getArticleLifecycle,
};

// ---------------------------------------------------------------------------
// GA4 monitoring queries
// ---------------------------------------------------------------------------

async function getExpiredArticlesForReactivation() {
  const sql = `
    SELECT id, article_id, url, domain, status, last_traffic_at
    FROM   articles
    WHERE  status = 'expired'
      AND  url IS NOT NULL
      AND  (expiry_reason IS NULL OR expiry_reason != 'disapproved')
    ORDER BY id`;
  const { rows } = await pool.query(sql);
  return rows;
}

async function getActiveArticlesWithUrl() {
  const sql = `
    SELECT id, article_id, url
    FROM   articles
    WHERE  status IN ('active', 'assigned')
      AND  url IS NOT NULL
    ORDER BY id`;
  const { rows } = await pool.query(sql);
  return rows;
}

async function getArticlesForGaMonitor() {
  const sql = `
    SELECT id, article_id, url, status, last_traffic_at
    FROM   articles
    WHERE  status IN ('active', 'assigned', 'expired')
      AND  url IS NOT NULL
      AND  (status != 'expired' OR (expiry_reason IS NULL OR expiry_reason != 'disapproved'))
    ORDER BY id`;
  const { rows } = await pool.query(sql);
  return rows;
}

async function upsertArticleGaMetrics(articleId, { activeUsers, sessions, pageviews }) {
  const sql = `
    INSERT INTO article_ga_metrics (article_id, users_ga, sessions, pageviews, checked_at)
    VALUES ($1, $2, $3, $4, NOW())
    ON CONFLICT (article_id) DO UPDATE
      SET users_ga   = EXCLUDED.users_ga,
          sessions   = EXCLUDED.sessions,
          pageviews  = EXCLUDED.pageviews,
          checked_at = EXCLUDED.checked_at`;
  await pool.query(sql, [articleId, activeUsers, sessions, pageviews]);
}

async function reactivateArticle(articleId, client) {
  const db = client || pool;
  const sql = `
    UPDATE articles
    SET    status          = 'pending',
           expiry_reason   = NULL,
           expired_at      = NULL,
           last_traffic_at = NULL,
           reactivated_at  = NOW()
    WHERE  id = $1
    RETURNING *`;
  const { rows } = await db.query(sql, [articleId]);
  return rows[0];
}

async function addArticleLifecycleEvent(articleId, event, triggeredBy, activeUsers = null) {
  const sql = `
    INSERT INTO article_lifecycle (article_id, event, triggered_by, active_users)
    VALUES ($1, $2, $3, $4)`;
  await pool.query(sql, [articleId, event, triggeredBy, activeUsers]);
}

async function updateArticleLastTrafficAt(articleId) {
  await pool.query(
    `UPDATE articles SET last_traffic_at = NOW() WHERE id = $1`,
    [articleId],
  );
}

async function getArticleGaMetrics(articleId) {
  const { rows } = await pool.query(
    `SELECT * FROM article_ga_metrics WHERE article_id = $1`,
    [articleId],
  );
  return rows[0] || null;
}

async function getArticleLifecycle(articleId) {
  const { rows } = await pool.query(
    `SELECT id, event, triggered_by, active_users, created_at
     FROM article_lifecycle
     WHERE article_id = $1
     ORDER BY created_at DESC`,
    [articleId],
  );
  return rows;
}
