'use client'

import useSWR from 'swr'
import { fetchHealth } from '@/lib/api-client'
import { useTheme } from '@/components/theme-provider'

interface HeaderProps {
  title: string
  subtitle?: string
}

export function Header({ title, subtitle }: HeaderProps) {
  const { data } = useSWR('health', fetchHealth, { refreshInterval: 30_000 })
  const healthy = data?.status === 'healthy'
  const { theme, toggle } = useTheme()

  return (
    <div className="flex items-center justify-between border-b border-white/[0.06] bg-[#0d0d0d] px-6 py-4">
      <div>
        <h1 className="text-base font-semibold text-white">{title}</h1>
        {subtitle && <p className="mt-0.5 text-xs text-zinc-500">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              data == null ? 'bg-zinc-600' : healthy ? 'bg-emerald-500' : 'bg-red-500'
            }`}
          />
          {data == null ? 'Connecting…' : healthy ? 'All systems healthy' : 'Degraded'}
        </div>
        <button
          onClick={toggle}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          className="flex h-8 w-8 items-center justify-center rounded-md border border-white/[0.1] text-zinc-400 transition-colors hover:border-white/[0.2] hover:text-zinc-200"
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
            </svg>
          )}
        </button>
      </div>
    </div>
  )
}
