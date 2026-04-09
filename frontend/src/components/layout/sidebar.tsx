'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { clearToken } from '@/lib/auth'
import { useRouter } from 'next/navigation'

const nav = [
  { href: '/overview',     label: 'Overview' },
  { href: '/revenue',      label: 'Revenue' },
  { href: '/channels',     label: 'Channels' },
  { href: '/assignments',  label: 'Assignments' },
  { href: '/alerts',       label: 'Alerts' },
]

export function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()

  function signOut() {
    clearToken()
    router.push('/login')
  }

  return (
    <aside className="flex h-screen w-56 shrink-0 flex-col border-r border-white/[0.07] bg-[#111111]">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <span className="h-2 w-2 rounded-full bg-blue-500" />
        <span className="text-sm font-semibold text-white">Channel Attribution</span>
      </div>

      <nav className="flex-1 space-y-0.5 px-3 pt-2">
        {nav.map(({ href, label }) => {
          const active = pathname.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                active
                  ? 'bg-white/[0.08] text-white'
                  : 'text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-300'
              }`}
            >
              {label}
            </Link>
          )
        })}
      </nav>

      <div className="border-t border-white/[0.06] p-3">
        <button
          onClick={signOut}
          className="w-full rounded-md px-3 py-2 text-left text-sm text-zinc-500 transition-colors hover:bg-white/[0.04] hover:text-zinc-300"
        >
          Sign out
        </button>
      </div>
    </aside>
  )
}
