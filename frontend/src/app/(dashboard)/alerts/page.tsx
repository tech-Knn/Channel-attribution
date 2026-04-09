'use client'

import { Header } from '@/components/layout/header'
import { TableWrap, Table } from '@/components/ui/table'
import { SkeletonRows } from '@/components/ui/skeleton'
import { useAlerts } from '@/hooks/useStats'
import { useIdleLoss } from '@/hooks/useChannels'
import { currency, timeAgo, number } from '@/lib/formatters'
import type { Alert, IdleLoss } from '@/types'

function alertMeta(a: Alert): { color: string; title: string; desc: string } {
  const d = a.details ?? {}
  if (a.alert_type === 'expiry') return {
    color: 'bg-amber-500',
    title: `Article expired — ${a.entity_name}`,
    desc: (d.reason as string) ?? 'Zero traffic · channel reclaimed',
  }
  if (a.alert_type === 'orphan_revenue') return {
    color: 'bg-red-500',
    title: `Orphan revenue — ${a.entity_name}`,
    desc: d.revenue ? `${currency(d.revenue as number)} with no article assigned` : 'Revenue with no assignment',
  }
  return {
    color: 'bg-red-500',
    title: `Channel disapproved — ${a.entity_name}`,
    desc: 'Requires manual review',
  }
}

const idleLossCols = [
  { key: 'channel', label: 'Channel', render: (r: IdleLoss) => <span className="font-mono text-xs text-zinc-300">{r.channel_id}</span> },
  { key: 'idle_hours', label: 'Idle Duration', render: (r: IdleLoss) => <span className="tabular-nums text-amber-400/80">{Number(r.idle_hours).toFixed(1)}h</span> },
  { key: 'revenue', label: 'Est. Lost Revenue', render: (r: IdleLoss) => <span className="tabular-nums font-semibold text-red-400">{currency(r.estimated_lost_revenue)}</span> },
]

export default function AlertsPage() {
  const { data: alerts, isLoading: alertsLoading } = useAlerts(50)
  const { data: idleLoss, isLoading: idleLossLoading } = useIdleLoss(30)

  return (
    <div>
      <Header title="Alerts" subtitle="Expiries, orphan revenue, disapprovals" />
      <div className="grid grid-cols-1 gap-6 p-6 lg:grid-cols-2">

        {/* Alert feed */}
        <div className="rounded-lg border border-white/[0.07] bg-[#1c1c1c]">
          <div className="border-b border-white/[0.06] px-4 py-3">
            <span className="text-sm font-semibold text-zinc-200">Recent Alerts</span>
          </div>
          <div className="divide-y divide-white/[0.04]">
            {alertsLoading ? (
              <div className="space-y-3 p-4">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex gap-3">
                    <div className="mt-1 h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-white/10" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-2.5 w-3/4 animate-pulse rounded bg-white/5" />
                      <div className="h-2 w-1/2 animate-pulse rounded bg-white/5" />
                    </div>
                  </div>
                ))}
              </div>
            ) : !alerts?.length ? (
              <p className="px-4 py-10 text-center text-sm text-zinc-600">No alerts — system is healthy</p>
            ) : (
              alerts.map((a, i) => {
                const { color, title, desc } = alertMeta(a)
                return (
                  <div key={i} className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-white/[0.02]">
                    <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${color}`} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-zinc-200">{title}</p>
                      <p className="mt-0.5 text-xs text-zinc-500">{desc}</p>
                      <p className="mt-1 text-[11px] text-zinc-600">{timeAgo(a.occurred_at)}</p>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* Idle loss */}
        <TableWrap title="Revenue Lost to Idle Time">
          {idleLossLoading ? (
            <table className="w-full"><tbody><SkeletonRows cols={3} rows={8} /></tbody></table>
          ) : (
            <Table
              columns={idleLossCols}
              data={idleLoss?.data ?? []}
              emptyMessage="No idle channels with loss data"
            />
          )}
        </TableWrap>

      </div>
    </div>
  )
}
