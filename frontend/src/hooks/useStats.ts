import useSWR from 'swr'
import { statsService } from '@/services/stats.service'

export function useStats(refreshInterval = 60_000) {
  return useSWR('stats', statsService.fetchStats, { refreshInterval })
}

export function useAlerts(limit = 50, refreshInterval = 60_000) {
  return useSWR(['alerts', limit], () => statsService.fetchAlerts(limit), { refreshInterval })
}
