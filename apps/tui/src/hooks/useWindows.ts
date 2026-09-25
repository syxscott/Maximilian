/**
 * Usage-windows loader for the Usage panel — the useWindows hook follows the
 * shape of the existing `useJobs` hook (plain useState + useEffect over
 * `sdk.client`, AbortController plumbing so unmounting cancels any in-flight
 * request, types imported from ../api) against GET /api/obs/usage/windows.
 *
 * Loaded on mount and refetched explicitly (the panel's r key) — no polling:
 * the usage-summary half of the panel owns the same manual cadence, so both
 * halves age together.
 */

import { useCallback, useEffect, useState } from "react"
import { useSDK } from "../context/sdk"
import type { UsageWindowBucket, UsageWindowsResponse } from "../api"

export interface UseWindowsResult {
  windows: UsageWindowBucket[]
  isError: boolean
  isLoading: boolean
  error: string | null
  refresh: () => void
}

export function useWindows(): UseWindowsResult {
  const sdk = useSDK()
  const [windows, setWindows] = useState<UsageWindowBucket[]>([])
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
        const res = await sdk.client.get<UsageWindowsResponse>("/api/obs/usage/windows")
        if (cancelled || ctrl.signal.aborted) return
        setWindows(Array.isArray(res?.windows) ? res.windows : [])
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

  return { windows, isError, isLoading, error, refresh }
}
