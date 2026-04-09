type Variant = 'active' | 'idle' | 'disapproved' | 'expired' | 'pending' | 'completed' | 'default'

const styles: Record<Variant, string> = {
  active:      'bg-emerald-500/10 text-emerald-400 ring-emerald-500/20',
  idle:        'bg-amber-500/10 text-amber-400 ring-amber-500/20',
  disapproved: 'bg-red-500/10 text-red-400 ring-red-500/20',
  expired:     'bg-zinc-500/10 text-zinc-400 ring-zinc-500/20',
  completed:   'bg-zinc-500/10 text-zinc-400 ring-zinc-500/20',
  pending:     'bg-blue-500/10 text-blue-400 ring-blue-500/20',
  default:     'bg-zinc-500/10 text-zinc-400 ring-zinc-500/20',
}

function resolveVariant(status: string): Variant {
  const s = status.toLowerCase()
  if (s === 'active' || s === 'assigned') return 'active'
  if (s === 'idle') return 'idle'
  if (s === 'disapproved') return 'disapproved'
  if (s === 'expired') return 'expired'
  if (s === 'completed') return 'completed'
  if (s === 'pending') return 'pending'
  return 'default'
}

export function Badge({ status }: { status: string }) {
  const variant = resolveVariant(status)
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ring-1 ring-inset ${styles[variant]}`}>
      {status}
    </span>
  )
}
