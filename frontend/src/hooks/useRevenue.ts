import useSWR from 'swr'
import { revenueService, type SortParams } from '@/services/revenue.service'

export function useRevenueSummary(refreshInterval = 60_000) {
  return useSWR('revenue-summary', revenueService.fetchSummary, { refreshInterval })
}

export function useRevenueByArticle(params: SortParams, enabled = true) {
  return useSWR(
    enabled ? ['rev-art', params] : null,
    () => revenueService.fetchByArticle(params),
    { refreshInterval: 60_000 },
  )
}

export function useRevenueByChannel(params: SortParams, enabled = true) {
  return useSWR(
    enabled ? ['rev-ch', params] : null,
    () => revenueService.fetchByChannel(params),
    { refreshInterval: 60_000 },
  )
}

export function useUnattributedRevenue(params: { limit: number; offset: number }, enabled = true) {
  return useSWR(
    enabled ? ['rev-unattr', params] : null,
    () => revenueService.fetchUnattributed(params),
    { refreshInterval: 60_000 },
  )
}
