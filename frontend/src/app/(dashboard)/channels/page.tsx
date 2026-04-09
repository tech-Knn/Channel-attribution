'use client'

import { useState } from 'react'
import { Header } from '@/components/layout/header'
import { TableWrap, Table } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Pagination } from '@/components/ui/pagination'
import { SkeletonRows } from '@/components/ui/skeleton'
import { useChannels, useIdleQueue } from '@/hooks/useChannels'
import { timeAgo, duration, shortDate } from '@/lib/formatters'
import type { Channel, IdleQueueEntry } from '@/types'

const LIMIT = 20

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'idle', label: 'Idle' },
  { value: 'assigned', label: 'Active' },
  { value: 'disapproved', label: 'Disapproved' },
  { value: 'manual_review', label: 'Manual Review' },
]

export default function ChannelsPage() {
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState('')

  const { data, isLoading } = useChannels({ limit: LIMIT, offset: (page - 1) * LIMIT, status: status || undefined })
  const { data: idleQueue } = useIdleQueue(20)

  const channelCols = [
    { key: 'id', label: 'ID', render: (c: Channel) => <span className="font-mono text-xs text-zinc-500">{c.id}</span> },
    { key: 'channel_id', label: 'Channel ID', render: (c: Channel) => <span className="font-mono text-xs text-zinc-300">{c.channel_id}</span> },
    { key: 'status', label: 'Status', render: (c: Channel) => <Badge status={c.status} /> },
    { key: 'idle_since', label: 'Idle Since', render: (c: Channel) => c.idle_since ? <span className="text-xs text-zinc-400">{timeAgo(c.idle_since)}</span> : <span className="text-zinc-600">—</span> },
    { key: 'assigned_to', label: 'Assigned To', render: (c: Channel) => c.assigned_to ? <span className="font-mono text-xs text-zinc-400">{c.assigned_to}</span> : <span className="text-zinc-600">—</span> },
    { key: 'updated_at', label: 'Last Updated', render: (c: Channel) => <span className="text-xs text-zinc-500">{timeAgo(c.updated_at)}</span> },
  ]

  const queueCols = [
    { key: 'position', label: 'Position', render: (r: IdleQueueEntry) => <span className="tabular-nums text-zinc-400">#{r.position}</span> },
    { key: 'channelId', label: 'Channel ID', render: (r: IdleQueueEntry) => <span className="font-mono text-xs text-zinc-300">{r.channelId}</span> },
    { key: 'idleSince', label: 'Idle Since', render: (r: IdleQueueEntry) => <span className="text-xs text-zinc-400">{shortDate(r.idleSince)}</span> },
    { key: 'duration', label: 'Duration', render: (r: IdleQueueEntry) => <span className="tabular-nums text-amber-400/80">{duration(r.idleSince)}</span> },
  ]

  return (
    <div>
      <Header title="Channels" subtitle={`${data?.total ?? '—'} total channels registered`} />
      <div className="space-y-6 p-6">
        <TableWrap
          title="All Channels"
          action={
            <select
              value={status}
              onChange={(e) => { setStatus(e.target.value); setPage(1) }}
              className="rounded-md border border-white/[0.1] bg-[#111] px-3 py-1.5 text-xs text-zinc-300 outline-none focus:border-blue-500/60"
            >
              {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          }
        >
          {isLoading ? (
            <table className="w-full"><tbody><SkeletonRows cols={6} /></tbody></table>
          ) : (
            <>
              <Table columns={channelCols} data={data?.data ?? []} emptyMessage="No channels found" />
              {data && <Pagination page={page} totalPages={Math.ceil(data.total / LIMIT)} total={data.total} limit={LIMIT} onPage={setPage} />}
            </>
          )}
        </TableWrap>

        <TableWrap title={`Idle Queue${idleQueue ? ` — ${idleQueue.total} waiting` : ''}`}>
          {!idleQueue ? (
            <table className="w-full"><tbody><SkeletonRows cols={4} rows={4} /></tbody></table>
          ) : (
            <Table columns={queueCols} data={idleQueue.data} emptyMessage="No channels in idle queue" />
          )}
        </TableWrap>
      </div>
    </div>
  )
}
