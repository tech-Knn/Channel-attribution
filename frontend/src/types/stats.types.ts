export interface DashboardStats {
  active_channels: number
  idle_channels: number
  disapproved_channels: number
  assigned_articles: number
  active_assignments: number
  revenue_today: string
}

export interface Alert {
  alert_type: 'expiry' | 'orphan_revenue' | 'disapproval'
  entity_id: string
  entity_name: string
  occurred_at: string
  details: Record<string, unknown>
}
