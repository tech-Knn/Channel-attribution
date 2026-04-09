import useSWR from 'swr'
import { channelsService } from '@/services/channels.service'

export function useChannels(params: { limit: number; offset: number; status?: string }) {
  return useSWR(
    ['channels', params],
    () => channelsService.fetchChannels(params),
    { refreshInterval: 30_000 },
  )
}

export function useIdleQueue(limit = 20) {
  return useSWR(
    ['idle-queue', limit],
    () => channelsService.fetchIdleQueue(limit),
    { refreshInterval: 30_000 },
  )
}

export function useIdleLoss(limit = 30) {
  return useSWR(
    ['idle-loss', limit],
    () => channelsService.fetchIdleLoss(limit),
    { refreshInterval: 60_000 },
  )
}
