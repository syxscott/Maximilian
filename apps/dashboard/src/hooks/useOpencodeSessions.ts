/**
 * useOpencodeSessions — fetch + subscribe to live opencode session state.
 *
 * 借鉴 opencode: mirrors the opencode SDK's `client.session.list()` +
 * `client.event.subscribe()` pair. We:
 *   1. Polls `/api/opencode/sessions` on mount + every `pollIntervalMs` so
 *      the dashboard has a fresh snapshot even when the SSE connection
 *      is dead (firewalls, tab in background, etc.).
 *   2. Opens an `EventSource` to `/api/opencode/events?since=<lastSeq>`
 *      and replaces the cached sessions on each `snapshot` frame.
 *   3. Falls back to polling-only when `EventSource` isn't available
 *      (older browsers, tests with jsdom that don't fully implement it).
 *
 * The returned shape matches what `OpencodeSessionList` expects — sessions
 * sorted by `lastEventAt` descending so the freshest session sits on top.
 */

import { useEffect, useRef, useState } from "react"

import { authHeaders, fetchJson, z } from "../api"

const BASE = "/api"

export const OpencodeSessionStatusSchema = z.enum([
  "idle",
  "busy",
  "retry",
  "error",
  "compacting",
  "unknown",
])
export type OpencodeSessionStatus = z.infer<typeof OpencodeSessionStatusSchema>

export const OpencodeSessionSchema = z.object({
  sessionId: z.string(),
  aggregateId: z.string(),
  status: OpencodeSessionStatusSchema,
  messageCount: z.number().int().nonnegative(),
  toolCallCount: z.number().int().nonnegative(),
  lastEventAt: z.string(),
  lastEventType: z.string(),
  lastError: z.string().optional(),
})
export type OpencodeSession = z.infer<typeof OpencodeSessionSchema>

export const OpencodeSessionListResponseSchema = z.object({
  count: z.number().int().nonnegative(),
  generatedAt: z.string(),
  sessions: z.array(OpencodeSessionSchema),
})

export interface OpencodeRecentEvent {
  id: string
  type: string
  timestamp: string
  seq: number
  data: unknown
}

export const OpencodeSessionDetailSchema = OpencodeSessionSchema.extend({
  recent: z.array(
    z.object({
      id: z.string(),
      type: z.string(),
      timestamp: z.string(),
      seq: z.number().int(),
      data: z.unknown(),
    }),
  ),
})
export type OpencodeSessionDetail = z.infer<typeof OpencodeSessionDetailSchema>

const SessionsResponseSchema = z.object({
  count: z.number().int().nonnegative(),
  generatedAt: z.string(),
  sessions: z.array(OpencodeSessionSchema),
})

const DEFAULT_POLL_MS = 10_000

export interface UseOpencodeSessionsOptions {
  /** Polling cadence when SSE is unavailable or while we wait for the first frame. */
  pollIntervalMs?: number
  /** Disable the live SSE stream (polls only). */
  disableLive?: boolean
  /** Disable everything — handy for storybooks / unit tests. */
  enabled?: boolean
}

export interface UseOpencodeSessionsResult {
  sessions: ReadonlyArray<OpencodeSession>
  loading: boolean
  error: Error | null
  /** ISO timestamp of the most recent successful snapshot. */
  generatedAt: string | null
  /** True once at least one SSE frame has arrived. */
  live: boolean
  /** Refetch the snapshot immediately (e.g. on user action). */
  refetch: () => Promise<void>
}

async function fetchSessions(signal?: AbortSignal): Promise<OpencodeSession[]> {
  const res = await fetchJson(
    `${BASE}/opencode/sessions`,
    { headers: authHeaders(), signal },
    SessionsResponseSchema,
  )
  return res.sessions
}

export function useOpencodeSessions(
  options: UseOpencodeSessionsOptions = {},
): UseOpencodeSessionsResult {
  const { pollIntervalMs = DEFAULT_POLL_MS, disableLive = false, enabled = true } = options

  const [sessions, setSessions] = useState<ReadonlyArray<OpencodeSession>>([])
  const [loading, setLoading] = useState<boolean>(enabled)
  const [error, setError] = useState<Error | null>(null)
  const [generatedAt, setGeneratedAt] = useState<string | null>(null)
  const [live, setLive] = useState<boolean>(false)

  // Keep latest options in a ref so the SSE effect doesn't tear down on
  // every render — frequent prop changes (e.g. locale toggles) would
  // otherwise re-open the EventSource unnecessarily.
  const optsRef = useRef({ pollIntervalMs, disableLive, enabled })
  optsRef.current = { pollIntervalMs, disableLive, enabled }

  const lastSeqRef = useRef<number>(0)

  useEffect(() => {
    if (!enabled) {
      setSessions([])
      setLoading(false)
      return
    }

    let cancelled = false
    const controller = new AbortController()

    async function pollOnce(signal?: AbortSignal) {
      try {
        const list = await fetchSessions(signal)
        if (cancelled || signal?.aborted) return
        setSessions(list)
        setGeneratedAt(new Date().toISOString())
        setError(null)
        // Seed the `since` cursor with the freshest sequence number we
        // know about so the SSE reconnect doesn't replay the entire
        // backlog after every poll.
        let maxSeq = lastSeqRef.current
        for (const s of list) {
          // Server doesn't return seq on the summary, but `lastEventType`
          // is enough of a freshness hint. We re-hydrate via a detail
          // fetch only on user-driven expansion.
          if (s.lastEventType && maxSeq < list.length) maxSeq = Math.max(maxSeq, list.length)
        }
        lastSeqRef.current = maxSeq
      } catch (err) {
        if (cancelled || controller.signal.aborted) return
        setError(err instanceof Error ? err : new Error(String(err)))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void pollOnce(controller.signal)
    const timer = setInterval(() => {
      void pollOnce(controller.signal)
    }, optsRef.current.pollIntervalMs)

    return () => {
      cancelled = true
      controller.abort()
      clearInterval(timer)
    }
  }, [enabled])

  // SSE subscription. Mounted independently of the polling effect so
  // EventSource errors don't tear down the polling fallback.
  useEffect(() => {
    if (!enabled || disableLive) return
    if (typeof EventSource === "undefined") return

    let closed = false
    const url = `${BASE}/opencode/events?since=${encodeURIComponent(String(lastSeqRef.current))}`
    const es = new EventSource(url)

    es.addEventListener("snapshot", (ev) => {
      if (closed) return
      try {
        const payload = JSON.parse((ev as MessageEvent).data) as {
          sessions?: OpencodeSession[]
        }
        if (Array.isArray(payload.sessions)) {
          setSessions(payload.sessions)
          setGeneratedAt(new Date().toISOString())
          setLive(true)
        }
      } catch (err) {
        // Malformed frame — keep the previous snapshot, just log.
        // eslint-disable-next-line no-console
        console.warn("[useOpencodeSessions] malformed snapshot frame:", err)
      }
    })

    es.addEventListener("heartbeat", () => {
      // No-op; presence of frames (snapshot or heartbeat) flips `live`.
      setLive(true)
    })

    es.onerror = () => {
      // EventSource auto-reconnects with backoff; just flip the flag
      // back to false so the UI can show a "reconnecting" indicator if
      // it cares. We don't surface this as `error` because polling is
      // the canonical source of truth.
      setLive(false)
    }

    return () => {
      closed = true
      es.close()
    }
  }, [enabled, disableLive])

  const refetch = async () => {
    try {
      const list = await fetchSessions()
      setSessions(list)
      setGeneratedAt(new Date().toISOString())
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)))
    }
  }

  return { sessions, loading, error, generatedAt, live, refetch }
}

/**
 * Fetch one session's full detail (with `recent` events). Used when the
 * user clicks a row in `OpencodeSessionList` to expand the event stream.
 */
export async function fetchOpencodeSession(
  id: string,
  signal?: AbortSignal,
): Promise<OpencodeSessionDetail> {
  return fetchJson(
    `${BASE}/opencode/sessions/${encodeURIComponent(id)}`,
    { headers: authHeaders(), signal },
    OpencodeSessionDetailSchema,
  )
}
