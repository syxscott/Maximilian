/**
 * Jobs list polling-free loader for the Jobs dialog — the useJobs hook
 * follows the shape of the existing `useLiveUsage` hook (plain
 * useState + useEffect over `sdk.client`, AbortController plumbing so
 * unmounting cancels any in-flight request, types imported from ../api).
 *
 * Unlike usage (30s polling), jobs are loaded on mount and refetched
 * explicitly (r key / after a delete or trigger) — the dialog owns that
 * cadence via `refresh()`.
 */

import { useCallback, useEffect, useState } from "react"
import { useSDK } from "../context/sdk"
import type { Job } from "../api"

export interface UseJobsResult {
  jobs: Job[]
  total: number
  isError: boolean
  isLoading: boolean
  error: string | null
  refresh: () => void
}

export function useJobs(): UseJobsResult {
  const sdk = useSDK()
  const [jobs, setJobs] = useState<Job[]>([])
  const [total, setTotal] = useState(0)
  const [isError, setIsError] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Bumped by refresh() to re-run the load effect.
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    const ctrl = new AbortController()
    let cancelled = false

    async function load() {
      setIsLoading(true)
      try {
        const res = await sdk.client.get<{ jobs: Job[]; total: number }>("/api/jobs")
        if (cancelled || ctrl.signal.aborted) return
        setJobs(Array.isArray(res?.jobs) ? res.jobs : [])
        setTotal(typeof res?.total === "number" ? res.total : 0)
        setIsError(false)
        setError(null)
      } catch (err) {
        if (cancelled || ctrl.signal.aborted) return
        setIsError(true)
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled && !ctrl.signal.aborted) setIsLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
      ctrl.abort()
    }
  }, [sdk.client, nonce])

  const refresh = useCallback(() => setNonce((n) => n + 1), [])

  return { jobs, total, isError, isLoading, error, refresh }
}

/** DELETE /api/jobs/{id} through the SDK client (no body, 204 on success). */
export async function deleteJobViaSdk(
  sdkClient: ReturnType<typeof useSDK>["client"],
  id: string,
): Promise<void> {
  const res = await sdkClient.raw(`/api/jobs/${encodeURIComponent(id)}`, { method: "DELETE" })
  if (!res.ok) throw new Error(`DELETE /api/jobs/${id} failed: ${res.status}`)
}

/** POST /api/jobs/{id}/trigger through the SDK client. */
export async function triggerJobViaSdk(
  sdkClient: ReturnType<typeof useSDK>["client"],
  id: string,
): Promise<void> {
  const res = await sdkClient.post(`/api/jobs/${encodeURIComponent(id)}/trigger`)
  if (
    res == null ||
    (typeof res === "object" && "ok" in res && (res as { ok?: unknown }).ok === false)
  ) {
    throw new Error(`trigger of /api/jobs/${id} returned ok:false`)
  }
}
