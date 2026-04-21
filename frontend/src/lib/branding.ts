/**
 * Tenant branding context for white-labeling.
 *
 * Fetches tenant branding (logo, colors, app name) on login
 * and caches in localStorage so it persists offline.
 */
import { useState, useEffect } from 'react'
import api from '@/lib/api'

export interface Branding {
  name: string
  logo_url: string
  primary_color: string
  app_name: string
  plan_tier: string
}

const DEFAULT_BRANDING: Branding = {
  name: 'FieldGovern',
  logo_url: '',
  primary_color: '#2563EB',
  app_name: 'FieldGovern',
  plan_tier: 'free',
}

const CACHE_KEY = 'fp_branding'

export function getCachedBranding(): Branding {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return DEFAULT_BRANDING
}

export function useBranding(): Branding {
  const [branding, setBranding] = useState<Branding>(getCachedBranding)

  useEffect(() => {
    api.get('/tenants/branding')
      .then(r => {
        const b: Branding = { ...DEFAULT_BRANDING, ...r.data }
        setBranding(b)
        localStorage.setItem(CACHE_KEY, JSON.stringify(b))
      })
      .catch(() => { /* use cached */ })
  }, [])

  return branding
}
