/**
 * Axios instance — automatically attaches JWT from localStorage.
 * Handles silent token refresh on 401 using the stored refresh token.
 */
import axios from 'axios'

const api = axios.create({ baseURL: '/api/v1' })

// Endpoints where a 401 means "this login attempt failed", not "an existing
// session expired" — safe to bail out immediately without trying refresh.
const SESSION_START_PATHS = ['/auth/login', '/auth/google', '/auth/verify-otp', '/auth/qr-login', '/auth/refresh']

api.interceptors.request.use(cfg => {
  const token = localStorage.getItem('fp_token')
  if (token) cfg.headers.Authorization = `Bearer ${token}`
  return cfg
})

// ── Refresh-token machinery ───────────────────────────────────────────────
let isRefreshing = false
let refreshQueue: ((token: string) => void)[] = []

function drainQueue(token: string) {
  refreshQueue.forEach(cb => cb(token))
  refreshQueue = []
}

api.interceptors.response.use(
  r => r,
  async (err) => {
    const original = err.config as typeof err.config & { _retry?: boolean }

    // ── 401 handling: attempt silent refresh ──────────────────────────────
    if (err.response?.status === 401 && !original._retry) {
      // Session-establishment endpoints: a 401 here means the login/refresh
      // attempt itself failed, not that an existing session expired — don't
      // recurse into refresh, just clear and bail. Other /auth/* endpoints
      // (change-password, 2FA setup/verify) are authenticated actions where
      // a 401 is a business-logic error (wrong password/code) and must NOT
      // wipe a valid session — let them fall through to normal refresh+retry.
      const isSessionStart = SESSION_START_PATHS.some(p => original.url?.includes(p))
      if (isSessionStart) {
        _clearSession()
        return Promise.reject(err)
      }

      // If another refresh is already in-flight, queue this request
      if (isRefreshing) {
        return new Promise(resolve => {
          refreshQueue.push(token => {
            original.headers.Authorization = `Bearer ${token}`
            resolve(api(original))
          })
        })
      }

      original._retry = true
      isRefreshing = true

      const storedRefresh = localStorage.getItem('fp_refresh_token')
      if (!storedRefresh) {
        isRefreshing = false
        _clearSession()
        return Promise.reject(err)
      }

      try {
        // Use raw axios (not the intercepted instance) to avoid loops
        const { data } = await axios.post('/api/v1/auth/refresh', {
          refresh_token: storedRefresh,
        })

        localStorage.setItem('fp_token', data.access_token)
        if (data.refresh_token) {
          localStorage.setItem('fp_refresh_token', data.refresh_token)
        }

        // Update the stored user object (preserve all existing fields)
        const stored = getStoredUser()
        if (stored) {
          localStorage.setItem('fp_user', JSON.stringify({ ...stored, access_token: data.access_token }))
        }

        original.headers.Authorization = `Bearer ${data.access_token}`
        drainQueue(data.access_token)
        return api(original)
      } catch {
        // Refresh failed — session is truly dead
        drainQueue('')
        _clearSession()
        return Promise.reject(err)
      } finally {
        isRefreshing = false
      }
    }

    // ── 402 — plan limit exceeded ─────────────────────────────────────────
    if (err.response?.status === 402) {
      window.dispatchEvent(new CustomEvent('fieldgovern:plan-limit', {
        detail: { message: err.response.data?.detail ?? 'Plan limit reached. Upgrade to continue.' },
      }))
    }

    // ── 403 — feature not in plan ─────────────────────────────────────────
    if (err.response?.status === 403 && err.response.data?.detail?.includes('plan')) {
      window.dispatchEvent(new CustomEvent('fieldgovern:feature-gate', {
        detail: { message: err.response.data?.detail ?? 'This feature requires a higher plan.' },
      }))
    }

    return Promise.reject(err)
  }
)

function _clearSession() {
  localStorage.removeItem('fp_token')
  localStorage.removeItem('fp_refresh_token')
  localStorage.removeItem('fp_user')
  window.location.href = '/login'
}

export default api

/**
 * Extract a display-safe string from an axios error. FastAPI's `detail` is a
 * plain string for HTTPException, but an array of {type, loc, msg, input}
 * objects for automatic Pydantic validation errors (422) — rendering that
 * array directly crashes React ("Objects are not valid as a React child").
 */
export function apiErrorMessage(err: unknown, fallback: string): string {
  const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  if (typeof detail === 'string' && detail) return detail
  if (Array.isArray(detail) && detail.length) {
    return detail.map(d => (d && typeof d === 'object' && 'msg' in d ? String((d as { msg: unknown }).msg) : String(d))).join('; ')
  }
  const msg = (err as { message?: string })?.message
  return typeof msg === 'string' && msg ? msg : fallback
}

// ── Auth helpers ──────────────────────────────────────────────────────────
export interface AuthUser {
  access_token: string
  refresh_token?: string
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
  if (user.refresh_token) localStorage.setItem('fp_refresh_token', user.refresh_token)
  localStorage.setItem('fp_user', JSON.stringify(user))
  rememberDevice(user)
  // Identify user in PostHog so funnels track real people, not anonymous IDs
  try {
    const ph = (window as any).posthog
    if (ph?.identify && user.id) {
      ph.identify(user.id, { email: user.email, name: user.name, role: user.role })
    }
  } catch { /* non-fatal */ }
}

// ── Returning-device memory ────────────────────────────────────────────────
// Survives logout (unlike fp_token/fp_user) so the login page can greet a
// returning user on this device instead of showing a blank form every time.
export interface KnownDevice {
  name: string
  identifier: string // phone or email, used to prefill the login field
}

function rememberDevice(user: AuthUser) {
  const identifier = user.phone || user.email
  if (!identifier) return
  localStorage.setItem('fp_known_device', JSON.stringify({ name: user.name, identifier } as KnownDevice))
}

export function getKnownDevice(): KnownDevice | null {
  try { return JSON.parse(localStorage.getItem('fp_known_device') ?? 'null') } catch { return null }
}

export function forgetKnownDevice() {
  localStorage.removeItem('fp_known_device')
}

export interface RegisterData {
  org_name: string
  admin_name: string
  email: string
  password: string
  segment: string
  phone?: string
}

export async function registerTenant(data: RegisterData) {
  const res = await api.post('/auth/register', data)
  return res.data as { message: string }
}

export async function verifyEmail(token: string): Promise<AuthUser> {
  const res = await api.get(`/auth/verify-email?token=${encodeURIComponent(token)}`)
  return res.data as AuthUser
}

export function logout() {
  try { (window as any).posthog?.reset?.() } catch { /* non-fatal */ }
  localStorage.removeItem('fp_token')
  localStorage.removeItem('fp_refresh_token')
  localStorage.removeItem('fp_user')
  window.location.href = '/login'
}
