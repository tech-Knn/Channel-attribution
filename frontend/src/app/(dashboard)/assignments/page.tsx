'use client'

import { useState } from 'react'
import { Header } from '@/components/layout/header'
import { TableWrap, Table } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Pagination } from '@/components/ui/pagination'
import { SkeletonRows } from '@/components/ui/skeleton'
import { useActiveAssignments, useAssignmentHistory } from '@/hooks/useAssignments'
import { shortDate, duration, timeAgo } from '@/lib/formatters'
import type { Assignment } from '@/types'

const LIMIT = 20
const MAX_AGE_MS = 72 * 3600 * 1000 // 3-day expiry window

function ProgressBar({ assignedAt }: { assignedAt: string }) {
  const elapsed = Date.now() - new Date(assignedAt).getTime()
  const pct = Math.min(100, Math.round((elapsed / MAX_AGE_MS) * 100))
  const color = pct > 80 ? 'bg-red-500' : pct > 50 ? 'bg-amber-500' : 'bg-blue-500'
  return (
    <div className="flex items-center gap-2">
      <div className="h-1 w-20 overflow-hidden rounded-full bg-white/[0.06]">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[11px] tabular-nums text-zinc-600">{pct}%</span>
    </div>
  )
}

export default function AssignmentsPage() {
  const [histStatus, setHistStatus] = useState('completed')
  const [histPage, setHistPage] = useState(1)

  const { data: active, isLoading: activeLoading } = useActiveAssignments()
  const { data: history, isLoading: histLoading } = useAssignmentHistory({ limit: LIMIT, offset: (histPage - 1) * LIMIT, status: histStatus })

  const activeCols = [
    { key: 'channel', label: 'Channel', render: (a: Assignment) => <span className="font-mono text-xs text-zinc-300">{a.channel_id}</span> },
    { key: 'article', label: 'Article', render: (a: Assignment) => <span className="font-mono text-xs text-zinc-400">{a.article_id}</span> },
    { key: 'url', label: 'URL', render: (a: Assignment) => a.article_url ? <a href={a.article_url} target="_blank" rel="noreferrer" className="block max-w-[200px] truncate text-xs text-blue-400 hover:underline">{a.article_url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 40)}</a> : <span className="text-zinc-600">—</span> },
    { key: 'assigned_at', label: 'Assigned', render: (a: Assignment) => <span className="text-xs text-zinc-400">{shortDate(a.assigned_at)}</span> },
    { key: 'duration', label: 'Duration', render: (a: Assignment) => <span className="tabular-nums text-xs">{duration(a.assigned_at)}</span> },
    { key: 'progress', label: 'Expiry Progress', render: (a: Assignment) => <ProgressBar assignedAt={a.assigned_at} /> },
  ]

  const histCols = [
    { key: 'channel', label: 'Channel', render: (a: Assignment) => <span className="font-mono text-xs text-zinc-300">{a.channel_id}</span> },
    { key: 'article', label: 'Article', render: (a: Assignment) => <span className="font-mono text-xs text-zinc-400">{a.article_id}</span> },
    { key: 'assigned_at', label: 'Assigned At', render: (a: Assignment) => <span className="text-xs text-zinc-400">{shortDate(a.assigned_at)}</span> },
    { key: 'unassigned_at', label: 'Closed At', render: (a: Assignment) => a.unassigned_at ? <span className="text-xs text-zinc-400">{shortDate(a.unassigned_at)}</span> : <span className="text-zinc-600">—</span> },
    { key: 'duration', label: 'Duration', render: (a: Assignment) => <span className="tabular-nums text-xs">{duration(a.assigned_at, a.unassigned_at)}</span> },
    { key: 'status', label: 'Status', render: (a: Assignment) => <Badge status={a.status} /> },
  ]

  return (
    <div>
      <Header title="Assignments" subtitle={`${active?.length ?? '—'} active · refreshes every 15s`} />
      <div className="space-y-6 p-6">
        <TableWrap title="Active Assignments">
          {activeLoading ? (
            <table className="w-full"><tbody><SkeletonRows cols={6} rows={4} /></tbody></table>
          ) : (
            <Table columns={activeCols} data={active ?? []} emptyMessage="No active assignments" />
          )}
        </TableWrap>

        <TableWrap
          title="History"
          action={
            <select
              value={histStatus}
              onChange={(e) => { setHistStatus(e.target.value); setHistPage(1) }}
              className="rounded-md border border-white/[0.1] bg-[#111] px-3 py-1.5 text-xs text-zinc-300 outline-none focus:border-blue-500/60"
            >
              <option value="completed">Completed</option>
              <option value="expired">Expired</option>
            </select>
          }
        >
          {histLoading ? (
            <table className="w-full"><tbody><SkeletonRows cols={6} /></tbody></table>
          ) : (
            <>
              <Table columns={histCols} data={history?.data ?? []} emptyMessage="No records found" />
              {history && <Pagination page={histPage} totalPages={Math.ceil(history.total / LIMIT)} total={history.total} limit={LIMIT} onPage={setHistPage} />}
            </>
          )}
        </TableWrap>
      </div>
    </div>
  )
}
