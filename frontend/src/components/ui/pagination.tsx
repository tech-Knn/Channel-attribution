interface PaginationProps {
  page: number
  totalPages: number
  total: number
  limit: number
  onPage: (page: number) => void
}

export function Pagination({ page, totalPages, total, limit, onPage }: PaginationProps) {
  const from = (page - 1) * limit + 1
  const to = Math.min(page * limit, total)

  return (
    <div className="flex items-center justify-between border-t border-white/[0.06] px-4 py-3">
      <span className="text-xs text-zinc-500">
        {from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()}
      </span>
      <div className="flex gap-1.5">
        <button
          onClick={() => onPage(page - 1)}
          disabled={page <= 1}
          className="rounded border border-white/[0.08] px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:border-white/20 hover:text-white disabled:cursor-default disabled:opacity-30"
        >
          Prev
        </button>
        <button
          onClick={() => onPage(page + 1)}
          disabled={page >= totalPages}
          className="rounded border border-white/[0.08] px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:border-white/20 hover:text-white disabled:cursor-default disabled:opacity-30"
        >
          Next
        </button>
      </div>
    </div>
  )
}
