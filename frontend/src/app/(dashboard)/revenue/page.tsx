'use client'

import { useState } from 'react'
import { Header } from '@/components/layout/header'
import { TableWrap, Table } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Pagination } from '@/components/ui/pagination'
import { SkeletonRows } from '@/components/ui/skeleton'
import { useRevenueByArticle, useRevenueByChannel, useUnattributedRevenue } from '@/hooks/useRevenue'
import { currency, number, shortDate, timeAgo } from '@/lib/formatters'
import type { RevenueByArticle, RevenueByChannel, UnattributedRevenue } from '@/types'

const LIMIT = 20

type Tab = 'article' | 'channel' | 'unattributed'

export default function RevenuePage() {
  const [tab, setTab] = useState<Tab>('article')

  const [artPage, setArtPage] = useState(1)
  const [artSort, setArtSort] = useState('total_revenue')
  const [artDir, setArtDir] = useState<'ASC' | 'DESC'>('DESC')

  const [chPage, setChPage] = useState(1)
  const [chSort, setChSort] = useState('total_revenue')
  const [chDir, setChDir] = useState<'ASC' | 'DESC'>('DESC')

  const [uPage, setUPage] = useState(1)

  const { data: artData, isLoading: artLoading } = useRevenueByArticle(
    { limit: LIMIT, offset: (artPage - 1) * LIMIT, sortBy: artSort, sortDir: artDir },
    tab === 'article',
  )

  const { data: chData, isLoading: chLoading } = useRevenueByChannel(
    { limit: LIMIT, offset: (chPage - 1) * LIMIT, sortBy: chSort, sortDir: chDir },
    tab === 'channel',
  )

  const { data: uData, isLoading: uLoading } = useUnattributedRevenue(
    { limit: LIMIT, offset: (uPage - 1) * LIMIT },
    tab === 'unattributed',
  )

  function toggleSort(col: string, current: string, dir: 'ASC' | 'DESC', setSort: (s: string) => void, setDir: (d: 'ASC' | 'DESC') => void, setPage: (p: number) => void) {
    if (current === col) setDir(dir === 'DESC' ? 'ASC' : 'DESC')
    else { setSort(col); setDir('DESC') }
    setPage(1)
  }

  const artCols = [
    { key: 'article_id', label: 'Article', render: (r: RevenueByArticle) => <span className="font-mono text-xs text-zinc-400">{r.article_id}</span> },
    { key: 'url', label: 'URL', render: (r: RevenueByArticle) => r.url ? <a href={r.url} target="_blank" rel="noreferrer" className="max-w-[220px] truncate block text-blue-400 hover:underline text-xs">{r.url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 45)}</a> : <span className="text-zinc-600">—</span> },
    { key: 'article_status', label: 'Status', render: (r: RevenueByArticle) => <Badge status={r.article_status} /> },
    { key: 'total_impressions', label: 'Impressions', sortable: true, render: (r: RevenueByArticle) => <span className="tabular-nums">{number(r.total_impressions)}</span> },
    { key: 'total_clicks', label: 'Clicks', sortable: true, render: (r: RevenueByArticle) => <span className="tabular-nums">{number(r.total_clicks)}</span> },
    { key: 'total_revenue', label: 'Revenue', sortable: true, render: (r: RevenueByArticle) => <span className="tabular-nums font-semibold text-emerald-400">{currency(r.total_revenue)}</span> },
    { key: 'rpm', label: 'RPM', sortable: true, render: (r: RevenueByArticle) => <span className="tabular-nums text-zinc-400">{r.rpm !== '0' ? currency(r.rpm) : '—'}</span> },
  ]

  const chCols = [
    { key: 'channel_id', label: 'Channel', render: (r: RevenueByChannel) => <span className="font-mono text-xs text-zinc-400">{r.channel_id}</span> },
    { key: 'channel_status', label: 'Status', render: (r: RevenueByChannel) => <Badge status={r.channel_status} /> },
    { key: 'articles_served', label: 'Articles Served', sortable: true, render: (r: RevenueByChannel) => <span className="tabular-nums">{number(r.articles_served)}</span> },
    { key: 'total_impressions', label: 'Impressions', sortable: true, render: (r: RevenueByChannel) => <span className="tabular-nums">{number(r.total_impressions)}</span> },
    { key: 'total_clicks', label: 'Clicks', sortable: true, render: (r: RevenueByChannel) => <span className="tabular-nums">{number(r.total_clicks)}</span> },
    { key: 'total_revenue', label: 'Revenue', sortable: true, render: (r: RevenueByChannel) => <span className="tabular-nums font-semibold text-emerald-400">{currency(r.total_revenue)}</span> },
  ]

  const uCols = [
    { key: 'channel', label: 'Channel', render: (r: UnattributedRevenue) => <span className="font-mono text-xs text-zinc-400">{r.channel_id}</span> },
    { key: 'revenue', label: 'Revenue', render: (r: UnattributedRevenue) => <span className="tabular-nums font-semibold text-red-400">{currency(r.revenue)}</span> },
    { key: 'impressions', label: 'Impressions', render: (r: UnattributedRevenue) => <span className="tabular-nums">{number(r.impressions)}</span> },
    { key: 'period_start', label: 'Period Start', render: (r: UnattributedRevenue) => <span className="text-xs text-zinc-400">{shortDate(r.period_start)}</span> },
    { key: 'period_end', label: 'Period End', render: (r: UnattributedRevenue) => <span className="text-xs text-zinc-400">{shortDate(r.period_end)}</span> },
    { key: 'pulled_at', label: 'Pulled', render: (r: UnattributedRevenue) => <span className="text-xs text-zinc-500">{timeAgo(r.pulled_at)}</span> },
  ]

  const tabs: { id: Tab; label: string }[] = [
    { id: 'article', label: 'By Article' },
    { id: 'channel', label: 'By Channel' },
    { id: 'unattributed', label: 'Unattributed' },
  ]

  return (
    <div>
      <Header title="Revenue" subtitle="Materialized views refresh every 15 minutes" />
      <div className="p-6">
        <div className="mb-5 flex gap-1 rounded-lg border border-white/[0.07] bg-[#161616] p-1 w-fit">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${tab === t.id ? 'bg-white/[0.08] text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'article' && (
          <TableWrap title="Revenue by Article">
            {artLoading ? (
              <table className="w-full"><tbody><SkeletonRows cols={7} /></tbody></table>
            ) : (
              <>
                <Table
                  columns={artCols}
                  data={artData?.data ?? []}
                  sortBy={artSort}
                  sortDir={artDir}
                  onSort={(col) => toggleSort(col, artSort, artDir, setArtSort, setArtDir, setArtPage)}
                  emptyMessage="No revenue data"
                />
                {artData && <Pagination page={artPage} totalPages={Math.ceil(artData.total / LIMIT)} total={artData.total} limit={LIMIT} onPage={setArtPage} />}
              </>
            )}
          </TableWrap>
        )}

        {tab === 'channel' && (
          <TableWrap title="Revenue by Channel">
            {chLoading ? (
              <table className="w-full"><tbody><SkeletonRows cols={6} /></tbody></table>
            ) : (
              <>
                <Table
                  columns={chCols}
                  data={chData?.data ?? []}
                  sortBy={chSort}
                  sortDir={chDir}
                  onSort={(col) => toggleSort(col, chSort, chDir, setChSort, setChDir, setChPage)}
                  emptyMessage="No revenue data"
                />
                {chData && <Pagination page={chPage} totalPages={Math.ceil(chData.total / LIMIT)} total={chData.total} limit={LIMIT} onPage={setChPage} />}
              </>
            )}
          </TableWrap>
        )}

        {tab === 'unattributed' && (
          <TableWrap title="Unattributed Revenue Events">
            {uLoading ? (
              <table className="w-full"><tbody><SkeletonRows cols={6} /></tbody></table>
            ) : (
              <>
                <Table columns={uCols} data={uData?.data ?? []} emptyMessage="No unattributed revenue" />
                {uData && <Pagination page={uPage} totalPages={Math.ceil(uData.total / LIMIT)} total={uData.total} limit={LIMIT} onPage={setUPage} />}
              </>
            )}
          </TableWrap>
        )}
      </div>
    </div>
  )
}
