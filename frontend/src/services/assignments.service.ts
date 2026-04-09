import { request } from '@/lib/api-client'
import type { Assignment, PaginatedResponse } from '@/types'

export const assignmentsService = {
  fetchActive: async (): Promise<Assignment[]> => {
    const res = await request<{ data: Assignment[]; total: number }>('/assignments/active')
    return res.data
  },

  fetchHistory: (params: { limit: number; offset: number; status: string }): Promise<PaginatedResponse<Assignment>> => {
    const qs = new URLSearchParams(params as unknown as Record<string, string>)
    return request(`/assignments?${qs}`)
  },
}
