export type { PaginatedResponse } from './common.types'
export type { Channel, IdleQueueEntry, IdleLoss } from './channel.types'
export type { Assignment } from './assignment.types'
export type { RevenueSummary, RevenueByArticle, RevenueByChannel, UnattributedRevenue } from './revenue.types'
export type { DashboardStats, Alert } from './stats.types'

// Legacy — kept for backwards compat with any existing Article references
export interface Article {
  id: string
  article_id: string
  url: string | null
  category: string | null
  status: 'pending' | 'assigned' | 'active' | 'expired' | 'stopped'
  published_at: string
  expired_at: string | null
  expiry_reason: string | null
  created_at: string
}
