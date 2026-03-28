/**
 * Axios instance — automatically attaches JWT from localStorage.
 * All API calls go through here.
 */
import axios from 'axios'

const api = axios.create({ baseURL: '/api/v1' })

api.interceptors.request.use(cfg => {
  const token = localStorage.getItem('fp_token')
  if (token) cfg.headers.Authorization = `Bearer ${token}`
  return cfg
})

api.interceptors.response.use(
  r => r,
  err => {
    // Only redirect to login on 401 from auth endpoints.
    // Field app data endpoints may 401 when offline — don't kill the session.
    const isAuthEndpoint = err.config?.url?.includes('/auth/')
    if (err.response?.status === 401 && isAuthEndpoint) {
      localStorage.removeItem('fp_token')
      localStorage.removeItem('fp_user')
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

export default api

// ── Auth helpers ──────────────────────────────────────────────────────────
export interface AuthUser {
  access_token: string
  role: string
  name: string
  id?: string
  email?: string
  phone?: string
}

export function getStoredUser(): AuthUser | null {
  try { return JSON.parse(localStorage.getItem('fp_user') ?? 'null') } catch { return null }
}

export function storeUser(user: AuthUser) {
  localStorage.setItem('fp_token', user.access_token)
  localStorage.setItem('fp_user', JSON.stringify(user))
}

export function logout() {
  localStorage.removeItem('fp_token')
  localStorage.removeItem('fp_user')
  window.location.href = '/login'
}
