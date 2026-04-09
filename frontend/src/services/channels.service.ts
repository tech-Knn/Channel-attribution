import { request } from '@/lib/api-client'
import type { Channel, IdleQueueEntry, IdleLoss, PaginatedResponse } from '@/types'

export const channelsService = {
  fetchChannels: (params: { limit: number; offset: number; status?: string }): Promise<PaginatedResponse<Channel>> => {
    const qs = new URLSearchParams(
      Object.fromEntries(
        Object.entries(params).filter(([, v]) => v !== undefined && v !== ''),
      ) as Record<string, string>,
    )
    return request(`/channels?${qs}`)
  },

  fetchIdleQueue: (limit = 20): Promise<{ data: IdleQueueEntry[]; total: number }> =>
    request(`/channels/idle?limit=${limit}`),

  fetchIdleLoss: (limit = 20): Promise<PaginatedResponse<IdleLoss>> =>
    request(`/channels/idle-loss?limit=${limit}`),
}
