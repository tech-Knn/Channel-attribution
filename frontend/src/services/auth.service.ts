import { request } from '@/lib/api-client'
import { saveToken, clearToken } from '@/lib/auth'

export const authService = {
  login: (email: string, password: string) =>
    request<{ token: string; message: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  register: (email: string, password: string) =>
    request<{ message: string; user: { id: number; email: string } }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  saveToken,
  clearToken,
}
