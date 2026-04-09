import { request } from '@/lib/api-client'
import type { DashboardStats, Alert } from '@/types'

export const statsService = {
  fetchStats: async (): Promise<DashboardStats> => {
    const res = await request<{ data: DashboardStats }>('/stats')
    return res.data
  },

  fetchAlerts: async (limit = 50): Promise<Alert[]> => {
    const res = await request<{ data: Alert[]; total: number }>(`/stats/alerts?limit=${limit}`)
    return res.data
  },
}
