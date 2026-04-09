'use client'

import { Header } from '@/components/layout/header'
import { StatCard } from '@/components/ui/stat-card'
import { TableWrap, Table } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { SkeletonRows } from '@/components/ui/skeleton'
import { RevenueChart } from '@/components/charts/revenue-chart'
import { useStats, useAlerts } from '@/hooks/useStats'
import { useRevenueSummary, useRevenueByArticle } from '@/hooks/useRevenue'
import { currency, number, percent, timeAgo } from '@/lib/formatters'
import type { RevenueByArticle, Alert } from '@/types'

const REFRESH = 60_000

function UtilBar({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0
  return (
    <div className="flex items-center gap-3">
      <span className="w-24 shrink-0 text-xs text-zinc-500">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
        <div className={`h-full rounded-full transition-all duration-700 ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-8 text-right text-xs tabular-nums text-zinc-500">{pct}%</span>
    </div>
  )
}

function alertVariant(type: string): string {
  if (type === 'disapproval') return 'bg-red-500'
  if (type === 'orphan_revenue') return 'bg-red-500'
  return 'bg-amber-500'
}

function alertTitle(a: Alert): string {
  if (a.alert_type === 'expiry') return `Article expired: ${a.entity_name}`
  if (a.alert_type === 'orphan_revenue') return `Orphan revenue on ${a.entity_name}`
  return `Channel disapproved: ${a.entity_name}`
}

function alertDesc(a: Alert): string {
  const d = a.details ?? {}
  if (a.alert_type === 'expiry') return (d.reason as string) ?? 'Zero traffic — channel reclaimed'
  if (a.alert_type === 'orphan_revenue') return d.revenue ? `${currency(d.revenue as number)} with no assignment` : 'Revenue with no article assigned'
  return 'Requires manual review'
}

export default function OverviewPage() {
  const { data: stats } = useStats(REFRESH)
  const { data: summary } = useRevenueSummary(REFRESH)
  const { data: topRevenue } = useRevenueByArticle({ limit: 8, offset: 0, sortBy: 'total_revenue', sortDir: 'DESC' })
  const { data: alerts } = useAlerts(5, REFRESH)

  const total = (stats?.active_channels ?? 0) + (stats?.idle_channels ?? 0) + (stats?.disapproved_channels ?? 0)

  const chartData = [
    { label: '30d', revenue: Number(summary?.revenue_30d ?? 0) },
    { label: '7d', revenue: Number(summary?.revenue_7d ?? 0) },
    { label: 'Today', revenue: Number(summary?.revenue_today ?? 0) },
  ]

  const revenueColumns = [
    { key: 'article_id', label: 'Article', render: (r: RevenueByArticle) => <span className="font-mono text-xs text-zinc-400">{r.article_id}</span> },
    { key: 'status', label: 'Status', render: (r: RevenueByArticle) => <Badge status={r.article_status} /> },
    { key: 'impressions', label: 'Impressions', render: (r: RevenueByArticle) => <span className="tabular-nums">{number(r.total_impressions)}</span> },
    { key: 'revenue', label: 'Revenue', render: (r: RevenueByArticle) => <span className="font-semibold tabular-nums text-emerald-400">{currency(r.total_revenue)}</span> },
  ]

  return (
    <div>
      <Header title="Overview" subtitle="Live system snapshot — refreshes every 60s" />

      <div className="p-6 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
          <StatCard label="Revenue Today" value={currency(stats?.revenue_today)} sub={`7d: ${currency(summary?.revenue_7d)}`} accent="blue" />
          <StatCard label="Active Channels" value={number(stats?.active_channels)} accent="green" />
          <StatCard label="Idle Channels" value={number(stats?.idle_channels)} accent="yellow" />
          <StatCard label="Disapproved" value={number(stats?.disapproved_channels)} accent="red" />
          <StatCard label="Articles Assigned" value={number(stats?.assigned_articles)} accent="blue" />
          <StatCard label="Active Assignments" value={number(stats?.active_assignments)} accent="green" />
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Revenue chart */}
          <div className="lg:col-span-2 rounded-lg border border-white/[0.07] bg-[#1c1c1c] p-5">
            <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-zinc-500">Revenue Trend</p>
            <RevenueChart data={chartData} />
          </div>

          {/* Channel utilisation */}
          <div className="rounded-lg border border-white/[0.07] bg-[#1c1c1c] p-5">
            <p className="mb-5 text-xs font-semibold uppercase tracking-widest text-zinc-500">Channel Utilisation</p>
            <div className="space-y-4">
              <UtilBar label="Active" value={stats?.active_channels ?? 0} total={total} color="bg-emerald-500" />
              <UtilBar label="Idle" value={stats?.idle_channels ?? 0} total={total} color="bg-amber-500" />
              <UtilBar label="Disapproved" value={stats?.disapproved_channels ?? 0} total={total} color="bg-red-500" />
            </div>
            {total > 0 && (
              <p className="mt-6 text-xs text-zinc-600">
                {percent(stats?.active_channels ?? 0, total)} utilised · {total} total channels
              </p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Top revenue */}
          <TableWrap title="Top Revenue Today">
            {!topRevenue ? (
              <table className="w-full"><tbody><SkeletonRows cols={4} rows={5} /></tbody></table>
            ) : (
              <Table columns={revenueColumns} data={topRevenue.data} emptyMessage="No revenue data yet" />
            )}
          </TableWrap>

          {/* Alerts */}
          <div className="rounded-lg border border-white/[0.07] bg-[#1c1c1c]">
            <div className="border-b border-white/[0.06] px-4 py-3">
              <span className="text-sm font-semibold text-zinc-200">Recent Alerts</span>
            </div>
            <div className="divide-y divide-white/[0.04]">
              {!alerts ? (
                <div className="p-4 space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="flex gap-3">
                      <div className="h-8 w-8 animate-pulse rounded bg-white/5" />
                      <div className="flex-1 space-y-1.5 pt-1">
                        <div className="h-2.5 w-3/4 animate-pulse rounded bg-white/5" />
                        <div className="h-2 w-1/2 animate-pulse rounded bg-white/5" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : alerts.length === 0 ? (
                <p className="px-4 py-10 text-center text-sm text-zinc-600">No alerts — system is healthy</p>
              ) : (
                alerts.map((a, i) => (
                  <div key={i} className="flex items-start gap-3 px-4 py-3">
                    <div className={`mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full ${alertVariant(a.alert_type)}`} />
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium text-zinc-200">{alertTitle(a)}</p>
                      <p className="mt-0.5 text-xs text-zinc-500">{alertDesc(a)}</p>
                      <p className="mt-0.5 text-[11px] text-zinc-600">{timeAgo(a.occurred_at)}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
