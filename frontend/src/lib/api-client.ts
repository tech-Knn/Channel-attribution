import { API_BASE } from '@/config'
import { getToken, clearToken } from '@/lib/auth'

export async function fetchHealth(): Promise<{ status: string }> {
  return fetch(`${API_BASE}/health`).then((r) => r.json())
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken()
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  })

  if (res.status === 401) {
    clearToken()
    window.location.href = '/login'
    throw new ApiError(401, 'Unauthorized')
  }

  const data = await res.json()

  if (!res.ok) {
    throw new ApiError(res.status, data.error ?? 'Request failed')
  }

  return data
}
