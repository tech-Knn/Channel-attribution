type Accent = 'blue' | 'green' | 'yellow' | 'red'

const accentBar: Record<Accent, string> = {
  blue:   'bg-blue-500',
  green:  'bg-emerald-500',
  yellow: 'bg-amber-500',
  red:    'bg-red-500',
}

interface StatCardProps {
  label: string
  value: string | number
  sub?: string
  accent?: Accent
}

export function StatCard({ label, value, sub, accent = 'blue' }: StatCardProps) {
  return (
    <div className="relative overflow-hidden rounded-lg border border-white/[0.07] bg-[#1c1c1c] p-5 transition-colors hover:border-white/[0.12]">
      <div className={`absolute inset-x-0 top-0 h-[2px] ${accentBar[accent]}`} />
      <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500">{label}</p>
      <p className="mt-2 text-[28px] font-bold leading-none tracking-tight text-white tabular-nums">{value}</p>
      {sub && <p className="mt-1.5 text-[11px] text-zinc-500">{sub}</p>}
    </div>
  )
}
