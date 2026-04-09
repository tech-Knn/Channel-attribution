export interface RevenueSummary {
  revenue_today: string
  impressions_today: number
  clicks_today: number
  revenue_7d: string
  impressions_7d: number
  clicks_7d: number
  revenue_30d: string
  impressions_30d: number
  clicks_30d: number
}

export interface RevenueByArticle {
  db_id: string
  article_id: string
  url: string | null
  category: string | null
  published_at: string
  article_status: string
  total_impressions: string
  total_clicks: string
  total_revenue: string
  rpm: string
}

export interface RevenueByChannel {
  db_id: string
  channel_id: string
  channel_status: string
  articles_served: string
  total_impressions: string
  total_clicks: string
  total_revenue: string
}

export interface UnattributedRevenue {
  id: string
  channel_id: string
  revenue: string
  impressions: number
  period_start: string
  period_end: string
  pulled_at: string
}
