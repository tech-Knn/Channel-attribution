export interface Channel {
  id: string
  channel_id: string
  status: 'idle' | 'assigned' | 'disapproved' | 'manual_review'
  idle_since: string | null
  assigned_to: string | null
  created_at: string
  updated_at: string
}

export interface IdleQueueEntry {
  position: number
  channelId: string
  idleSince: string
  idleDurationMs: number
}

export interface IdleLoss {
  db_id: string
  channel_id: string
  idle_since: string
  idle_hours: string
  estimated_lost_revenue: string
}
