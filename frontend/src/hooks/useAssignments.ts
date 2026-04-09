import useSWR from 'swr'
import { assignmentsService } from '@/services/assignments.service'

export function useActiveAssignments() {
  return useSWR('assignments-active', assignmentsService.fetchActive, { refreshInterval: 15_000 })
}

export function useAssignmentHistory(params: { limit: number; offset: number; status: string }) {
  return useSWR(
    ['assignments-hist', params],
    () => assignmentsService.fetchHistory(params),
    { refreshInterval: 30_000 },
  )
}
