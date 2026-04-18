/**
 * Database Queries — All SQL operations as async functions.
 *
 * Every query goes through the shared pool. Functions return plain objects
 * or arrays — no ORM, no magic. Callers get exactly what PostgreSQL returns.
 */

'use strict';

const { pool } = require('./pool');

// ═══════════════════════════════════════════════════════════════════════════
// Articles
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create a new article.
 */
async function createArticle({ articleId, url, category, status = 'pending', publishedAt, domain = 'articlespectrum.com' }) {
  const sql = `
    INSERT INTO articles (article_id, url, category, status, published_at, domain)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *`;
  const { rows } = await pool.query(sql, [articleId, url, category, status, publishedAt, domain]);
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
  const sql = `
    SELECT * FROM articles ${where}
    ORDER BY published_at DESC
    LIMIT $${idx++} OFFSET $${idx++}`;
  params.push(limit, offset);

  const { rows } = await pool.query(sql, params);

  // Count total
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

  const sql = `UPDATE articles SET ${sets.join(', ')} WHERE id = $1 RETURNING *`;
  const { rows } = await db.query(sql, params);
  return rows[0] || null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Channels
// ═══════════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════════
// Assignments
// ═══════════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════════
// Revenue
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get revenue summary — today, 7 days, 30 days.
 */
async function getRevenueSummary() {
  const sql = `
    SELECT
      COALESCE(SUM(CASE WHEN period_start >= NOW() - INTERVAL '1 day' THEN revenue ELSE 0 END), 0)::numeric AS revenue_today,
      COALESCE(SUM(CASE WHEN period_start >= NOW() - INTERVAL '1 day' THEN impressions ELSE 0 END), 0)::int AS impressions_today,
      COALESCE(SUM(CASE WHEN period_start >= NOW() - INTERVAL '1 day' THEN clicks ELSE 0 END), 0)::int AS clicks_today,
      COALESCE(SUM(CASE WHEN period_start >= NOW() - INTERVAL '7 days' THEN revenue ELSE 0 END), 0)::numeric AS revenue_7d,
      COALESCE(SUM(CASE WHEN period_start >= NOW() - INTERVAL '7 days' THEN impressions ELSE 0 END), 0)::int AS impressions_7d,
      COALESCE(SUM(CASE WHEN period_start >= NOW() - INTERVAL '7 days' THEN clicks ELSE 0 END), 0)::int AS clicks_7d,
      COALESCE(SUM(CASE WHEN period_start >= NOW() - INTERVAL '30 days' THEN revenue ELSE 0 END), 0)::numeric AS revenue_30d,
      COALESCE(SUM(CASE WHEN period_start >= NOW() - INTERVAL '30 days' THEN impressions ELSE 0 END), 0)::int AS impressions_30d,
      COALESCE(SUM(CASE WHEN period_start >= NOW() - INTERVAL '30 days' THEN clicks ELSE 0 END), 0)::int AS clicks_30d
    FROM revenue_events`;
  const { rows } = await pool.query(sql);
  return rows[0];
}

/**
 * Revenue per article from materialized view.
 */
async function getRevenueByArticle({ limit = 50, offset = 0, sortBy = 'total_revenue', sortDir = 'DESC' } = {}) {
  const allowedSorts = ['total_revenue', 'total_impressions', 'total_clicks', 'rpm', 'published_at'];
  const sort = allowedSorts.includes(sortBy) ? sortBy : 'total_revenue';
  const dir = sortDir.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

  const sql = `
    SELECT * FROM mv_revenue_per_article
    ORDER BY ${sort} ${dir}
    LIMIT $1 OFFSET $2`;
  const { rows } = await pool.query(sql, [limit, offset]);

  const { rows: countRows } = await pool.query(`SELECT COUNT(*)::int AS total FROM mv_revenue_per_article`);
  const total = countRows[0].total;

  return { data: rows, total, limit, offset };
}

/**
 * Revenue per channel from materialized view.
 */
async function getRevenueByChannel({ limit = 50, offset = 0, sortBy = 'total_revenue', sortDir = 'DESC' } = {}) {
  const allowedSorts = ['total_revenue', 'total_impressions', 'total_clicks', 'articles_served'];
  const sort = allowedSorts.includes(sortBy) ? sortBy : 'total_revenue';
  const dir = sortDir.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

  const sql = `
    SELECT * FROM mv_revenue_per_channel
    ORDER BY ${sort} ${dir}
    LIMIT $1 OFFSET $2`;
  const { rows } = await pool.query(sql, [limit, offset]);

  const { rows: countRows } = await pool.query(`SELECT COUNT(*)::int AS total FROM mv_revenue_per_channel`);
  const total = countRows[0].total;

  return { data: rows, total, limit, offset };
}

/**
 * Get unattributed revenue (revenue with no article assignment).
 */
async function getUnattributedRevenue({ limit = 50, offset = 0 } = {}) {
  const sql = `
    SELECT r.*, c.channel_id AS channel_id
    FROM revenue_events r
    JOIN channels c ON c.id = r.channel_id
    WHERE r.attributed = FALSE OR r.article_id IS NULL
    ORDER BY r.period_start DESC
    LIMIT $1 OFFSET $2`;
  const { rows } = await pool.query(sql, [limit, offset]);

  const countSql = `
    SELECT COUNT(*)::int AS total FROM revenue_events
    WHERE attributed = FALSE OR article_id IS NULL`;
  const { rows: countRows } = await pool.query(countSql);
  const total = countRows[0].total;

  return { data: rows, total, limit, offset };
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

// ═══════════════════════════════════════════════════════════════════════════
// Dashboard Stats
// ═══════════════════════════════════════════════════════════════════════════

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
  // Combine multiple alert sources
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

// ═══════════════════════════════════════════════════════════════════════════
// Channel Log
// ═══════════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════════
// Additional Functions (used by workers)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Find articles published 72-96 hours ago with zero revenue events.
 */
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
  const sql = `
    UPDATE assignments SET unassigned_at = NOW(), status = $2
    WHERE article_id = $1 AND status = 'active'
    RETURNING *`;
  const { rows } = await db.query(sql, [articleId, status]);
  return rows[0] || null;
}

/**
 * Upsert a revenue event (dedup on channel_id + period_start).
 */
async function upsertRevenueEvent({ channelId, articleId, assignmentId, impressions, clicks, revenue, periodStart, periodEnd, attributed = true }) {
  const sql = `
    INSERT INTO revenue_events (channel_id, article_id, assignment_id, impressions, clicks, revenue, period_start, period_end, attributed)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    ON CONFLICT (channel_id, period_start)
    DO UPDATE SET
      article_id = EXCLUDED.article_id,
      assignment_id = EXCLUDED.assignment_id,
      impressions = EXCLUDED.impressions,
      clicks = EXCLUDED.clicks,
      revenue = EXCLUDED.revenue,
      period_end = EXCLUDED.period_end,
      attributed = EXCLUDED.attributed,
      pulled_at = NOW()
    RETURNING *`;
  const { rows } = await pool.query(sql, [channelId, articleId, assignmentId, impressions, clicks, revenue, periodStart, periodEnd, attributed]);
  return rows[0];
}

// Aliases for worker compatibility
const logChannelEvent = addChannelLog;
const getActiveAssignmentByChannel = getActiveAssignmentForChannel;

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

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
  getRevenueSummary,
  getRevenueByArticle,
  getRevenueByChannel,
  getUnattributedRevenue,
  refreshMaterializedViews,
  refreshIdleLossView,
  getIdleChannelLoss,

  // Dashboard
  getDashboardStats,
  getRecentAlerts,

  // Logging
  addChannelLog,

  // Worker aliases & additions
  logChannelEvent,
  getActiveAssignmentByChannel,
  getZeroRevenueArticles,
  closeAssignmentByArticle,
  upsertRevenueEvent,

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
    SELECT id, article_id, url, status, last_traffic_at
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

// kept for API route compatibility
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
    SET    status         = 'pending',
           expiry_reason  = NULL,
           expired_at     = NULL,
           reactivated_at = NOW()
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
