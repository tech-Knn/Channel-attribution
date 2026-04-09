import { request } from '@/lib/api-client'
import type { RevenueSummary, RevenueByArticle, RevenueByChannel, UnattributedRevenue, PaginatedResponse } from '@/types'

export interface SortParams {
  limit: number
  offset: number
  sortBy: string
  sortDir: 'ASC' | 'DESC'
}

export const revenueService = {
  fetchSummary: async (): Promise<RevenueSummary> => {
    const res = await request<{ data: RevenueSummary }>('/revenue/summary')
    return res.data
  },

  fetchByArticle: (params: SortParams): Promise<PaginatedResponse<RevenueByArticle>> => {
    const qs = new URLSearchParams(params as unknown as Record<string, string>)
    return request(`/revenue/by-article?${qs}`)
  },

  fetchByChannel: (params: SortParams): Promise<PaginatedResponse<RevenueByChannel>> => {
    const qs = new URLSearchParams(params as unknown as Record<string, string>)
    return request(`/revenue/by-channel?${qs}`)
  },

  fetchUnattributed: (params: { limit: number; offset: number }): Promise<PaginatedResponse<UnattributedRevenue>> => {
    const qs = new URLSearchParams(params as unknown as Record<string, string>)
    return request(`/revenue/unattributed?${qs}`)
  },
}
