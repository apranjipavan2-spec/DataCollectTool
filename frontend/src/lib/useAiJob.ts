import { useState, useEffect, useRef, useCallback } from 'react'
import api from '@/lib/api'

export type AiJobStatus = 'idle' | 'pending' | 'running' | 'done' | 'failed'

export interface AiJob {
  status: AiJobStatus
  steps: string[]
  result: string | null
  error: string | null
}

interface UseAiJobOptions {
  /** localStorage key to persist the job_id across page reloads/navigation */
  storageKey: string
  pollIntervalMs?: number
}

interface UseAiJobReturn {
  jobId: string | null
  job: AiJob | null
  isRunning: boolean
  startJob: (postFn: () => Promise<{ data: { job_id: string } }>) => Promise<void>
  reset: () => void
}

const POLL_MS = 3000

export function useAiJob({ storageKey, pollIntervalMs = POLL_MS }: UseAiJobOptions): UseAiJobReturn {
  const [jobId, setJobId] = useState<string | null>(() => localStorage.getItem(storageKey))
  const [job, setJob] = useState<AiJob | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPolling = useCallback(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }
  }, [])

  const poll = useCallback(async (id: string) => {
    try {
      const { data } = await api.get(`/fg/ai-jobs/${id}`)
      setJob(data)
      if (data.status === 'done' || data.status === 'failed') {
        stopPolling()
        // Keep job_id in localStorage until user explicitly resets (so result survives navigation)
      }
    } catch {
      // network blip — keep polling
    }
  }, [stopPolling])

  const startPolling = useCallback((id: string) => {
    stopPolling()
    poll(id) // immediate first fetch
    intervalRef.current = setInterval(() => poll(id), pollIntervalMs)
  }, [poll, stopPolling, pollIntervalMs])

  // Resume polling on mount if we have a stored jobId
  useEffect(() => {
    if (jobId) startPolling(jobId)
    return stopPolling
  }, [jobId, startPolling, stopPolling])

  const startJob = useCallback(async (postFn: () => Promise<{ data: { job_id: string } }>) => {
    stopPolling()
    setJob({ status: 'pending', steps: [], result: null, error: null })
    try {
      const { data } = await postFn()
      const id = data.job_id
      localStorage.setItem(storageKey, id)
      setJobId(id)
      startPolling(id)
    } catch (e: any) {
      // Without this, a caller that awaits/catches this rejection (to show its
      // own toast) still leaves `job.status` stuck at 'pending' forever — no
      // job_id was ever issued, so polling never starts and the UI shows an
      // indefinite spinner even though the request never actually started.
      setJob({ status: 'failed', steps: [], result: null, error: e?.response?.data?.detail || e?.message || 'Failed to start' })
      throw e
    }
  }, [storageKey, startPolling, stopPolling])

  const reset = useCallback(() => {
    stopPolling()
    localStorage.removeItem(storageKey)
    setJobId(null)
    setJob(null)
  }, [storageKey, stopPolling])

  return {
    jobId,
    job,
    isRunning: job?.status === 'pending' || job?.status === 'running',
    startJob,
    reset,
  }
}
