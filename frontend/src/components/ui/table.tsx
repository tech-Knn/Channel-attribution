import { ReactNode } from 'react'

interface Column<T> {
  key: string
  label: string
  sortable?: boolean
  render: (row: T) => ReactNode
  className?: string
}

interface TableProps<T> {
  columns: Column<T>[]
  data: T[]
  sortBy?: string
  sortDir?: 'ASC' | 'DESC'
  onSort?: (key: string) => void
  emptyMessage?: string
}

export function Table<T>({ columns, data, sortBy, sortDir, onSort, emptyMessage = 'No data' }: TableProps<T>) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-white/[0.06] bg-black/20">
            {columns.map((col) => (
              <th
                key={col.key}
                onClick={() => col.sortable && onSort?.(col.key)}
                className={`px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-widest text-zinc-500 ${col.sortable ? 'cursor-pointer select-none hover:text-zinc-300' : ''} ${sortBy === col.key ? 'text-blue-400' : ''} ${col.className ?? ''}`}
              >
                {col.label}
                {col.sortable && (
                  <span className="ml-1 opacity-50">
                    {sortBy === col.key ? (sortDir === 'DESC' ? '↓' : '↑') : '↕'}
                  </span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-10 text-center text-sm text-zinc-600">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            data.map((row, i) => (
              <tr key={i} className="border-b border-white/[0.04] transition-colors hover:bg-white/[0.02]">
                {columns.map((col) => (
                  <td key={col.key} className={`px-4 py-2.5 text-zinc-300 ${col.className ?? ''}`}>
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

export function TableWrap({ title, action, children }: { title?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-white/[0.07] bg-[#1c1c1c] overflow-hidden">
      {(title || action) && (
        <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
          {title && <span className="text-sm font-semibold text-zinc-200">{title}</span>}
          {action && <div>{action}</div>}
        </div>
      )}
      {children}
    </div>
  )
}
