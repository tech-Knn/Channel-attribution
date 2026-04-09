export interface Assignment {
  id: string
  article_id: string
  channel_id: string
  assigned_at: string
  unassigned_at: string | null
  status: 'active' | 'completed' | 'expired'
  created_at: string
  article_url: string | null
}
