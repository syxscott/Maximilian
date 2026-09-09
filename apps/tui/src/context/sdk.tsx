/**
 * SDK context: typed RPC client + global event stream.
 *
 * Ported from OpenCode's SolidJS `sdk.tsx`. The original used the
 * `@opencode-ai/sdk/v2` typed client; Maximilian doesn't have an equivalent
 * yet, so we ship a minimal fetch-based wrapper plus an in-memory event bus.
 *
 * Consumers that need to talk to a real OpenCode-compatible server can swap
 * `createDefaultClient` for a generated SDK by re-implementing this file.
 */

import { useEffect, useRef } from "react"
import { createSimpleContext } from "./helper"

export type GlobalEvent = {
  type: string
  properties?: Record<string, unknown>
}

export type EventSource = {
  subscribe: (handler: (event: GlobalEvent) => void) => Promise<() => void>
}

export type SdkClient = {
  raw: (path: string, init?: RequestInit) => Promise<Response>
  get: <T = unknown>(path: string) => Promise<T>
  post: <T = unknown>(path: string, body?: unknown) => Promise<T>
  /**
   * Optional namespace methods ported over from the OpenCode SDK surface.
   * Maximilian's real API does not implement all of these yet — the TUI
   * falls back to no-ops (or local state) when the methods are missing.
   * Declaring them as optional on the type lets call sites drop `as any`
   * casts while still tolerating the runtime absence.
   */
  session?: {
    fork?: (input: {
      sessionID: string
      messageID?: string
    }) => Promise<{ data?: { id?: string } } | undefined>
    revert?: (input: { sessionID: string; messageID: string }) => void | Promise<void>
  }
  permission?: {
    reply?: (input: {
      reply: "once" | "always" | "reject"
      requestID: string
      directory: string
      workspace?: string
      // Optional rationale for the decision. The Maximilian backend can
      // echo this back to the agent so it can adapt (e.g. skip the
      // tool it just got rejected). OpenCode's SDK surface doesn't
      // model this yet, but we ship it as an optional field so the
      // TUI can pass user feedback without a type-cast.
      message?: string
    }) => void | Promise<void>
  }
  question?: {
    reply?: (input: {
      requestID: string
      directory: string
      answers: string[][]
    }) => void | Promise<void>
    reject?: (input: { requestID: string; directory: string }) => void | Promise<void>
  }
  find?: {
    files?: (input: {
      query?: string
      workspace?: string
    }) => Promise<{ data?: string[]; error?: unknown }>
  }
}

function createDefaultClient(
  url: string,
  init?: {
    directory?: string
    headers?: RequestInit["headers"]
    signal?: AbortSignal
    token?: string
  },
): SdkClient {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(init?.headers as Record<string, string> | undefined),
  }
  if (init?.directory) headers["x-maximilian-directory"] = init.directory
  if (init?.token) headers["authorization"] = `Bearer ${init.token}`

  const fetchImpl: typeof fetch =
    globalThis.fetch?.bind(globalThis) ??
    (() => Promise.reject(new Error("fetch is not available")))

  return {
    raw: (path: string, requestInit?: RequestInit) =>
      fetchImpl(new URL(path, url).toString(), {
        ...requestInit,
        headers: { ...headers, ...(requestInit?.headers as Record<string, string> | undefined) },
      }),
    get: async <T,>(path: string): Promise<T> => {
      const res = await fetchImpl(new URL(path, url).toString(), {
        method: "GET",
        headers,
        signal: init?.signal,
      })
      if (!res.ok) throw new Error(`SDK GET ${path} failed: ${res.status}`)
      return (await res.json()) as T
    },
    post: async <T,>(path: string, body?: unknown): Promise<T> => {
      const res = await fetchImpl(new URL(path, url).toString(), {
        method: "POST",
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: init?.signal,
      })
      if (!res.ok) throw new Error(`SDK POST ${path} failed: ${res.status}`)
      return (await res.json()) as T
    },
  }
}

export type SdkContextValue = {
  client: SdkClient
  directory?: string
  event: {
    emit: (type: "event", event: GlobalEvent) => void
    on: (type: "event", handler: (event: GlobalEvent) => void) => () => void
  }
  fetch: typeof fetch
  url: string
}

export const { use: useSDK, provider: SDKProvider } = createSimpleContext<
  SdkContextValue,
  {
    url: string
    directory?: string
    fetch?: typeof fetch
    headers?: RequestInit["headers"]
    events?: EventSource
    token?: string
    enableSSE?: boolean
  }
>({
  name: "SDK",
  init: (props) => {
    // Use refs to persist state across re-renders. helper.tsx calls init()
    // on every render, so we must NOT allocate new resources each call.
    const abortRef = useRef<AbortController | undefined>(undefined)
    if (!abortRef.current) abortRef.current = new AbortController()
    const abort = abortRef.current
    const sseRef = useRef<AbortController | undefined>(undefined)

    const sdk: SdkClient = createDefaultClient(props.url, {
      directory: props.directory,
      headers: props.headers,
      signal: abort.signal,
      token: props.token,
    })

    const handlersRef = useRef<Set<(event: GlobalEvent) => void> | undefined>(undefined)
    if (!handlersRef.current) handlersRef.current = new Set()
    const handlers = handlersRef.current
    const emitter = {
      emit(_type: "event", event: GlobalEvent) {
        for (const handler of handlers) handler(event)
      },
      on(_type: "event", handler: (event: GlobalEvent) => void) {
        handlers.add(handler)
        return () => {
          handlers.delete(handler)
        }
      },
    }

    let queue: GlobalEvent[] = []
    let timer: ReturnType<typeof setTimeout> | undefined
    let last = 0
    const retryDelay = 1000
    const maxRetryDelay = 30000
    // A stream that stayed up this long counts as "healthy"; only healthy
    // closes reset the reconnect backoff. A server that accepts the
    // connection but closes it immediately never qualifies, so it still
    // gets capped backoff instead of an unbounded 1-reconnect/second loop.
    const healthyStreamMs = 30_000

    const flush = () => {
      if (queue.length === 0) return
      const events = queue
      queue = []
      timer = undefined
      last = Date.now()
      for (const event of events) emitter.emit("event", event)
    }

    const handleEvent = (event: GlobalEvent) => {
      queue.push(event)
      const elapsed = Date.now() - last
      if (timer) return
      if (elapsed < 16) {
        timer = setTimeout(flush, 16)
        return
      }
      flush()
    }

    function startSSE() {
      sseRef.current?.abort()
      const ctrl = new AbortController()
      sseRef.current = ctrl
      void (async () => {
        // `attempt` counts consecutive UNHEALTHY closes (connect errors and
        // streams that dropped before healthyStreamMs). The previous
        // implementation bumped `attempt` on every loop iteration including
        // successful ones, so after a long-running healthy stream the
        // backoff could be stuck at the 30s cap even though the next
        // attempt would almost certainly succeed.
        let attempt = 0
        while (true) {
          if (abort.signal.aborted || ctrl.signal.aborted) break
          let failed = false
          const connectedAt = Date.now()
          try {
            const res = await sdk.raw("/global/event", { signal: ctrl.signal })
            if (!res.ok || !res.body) throw new Error(`SSE failed: ${res.status}`)
            const reader = res.body.getReader()
            const decoder = new TextDecoder()
            let buf = ""

            while (true) {
              const { value, done } = await reader.read()
              if (done) break
              if (ctrl.signal.aborted) break
              buf += decoder.decode(value, { stream: true })
              let idx
              while ((idx = buf.indexOf("\n\n")) !== -1) {
                const block = buf.slice(0, idx)
                buf = buf.slice(idx + 2)
                const dataLines = block
                  .split("\n")
                  .filter((line) => line.startsWith("data:"))
                  .map((line) => line.slice(5).trim())
                  .join("\n")
                if (!dataLines) continue
                try {
                  handleEvent(JSON.parse(dataLines) as GlobalEvent)
                } catch {
                  /* malformed line, skip */
                }
              }
            }
          } catch {
            failed = true
            /* fall through to backoff */
          }
          if (timer) clearTimeout(timer)
          if (queue.length > 0) flush()
          const healthyClose = !failed && Date.now() - connectedAt >= healthyStreamMs
          attempt = healthyClose ? 0 : attempt + 1
          if (abort.signal.aborted || ctrl.signal.aborted) break
          // attempt === 0 → reconnect immediately; otherwise 1s, 2s, … capped.
          const backoff =
            attempt === 0 ? 0 : Math.min(retryDelay * 2 ** (attempt - 1), maxRetryDelay)
          await new Promise((resolve) => setTimeout(resolve, backoff))
        }
      })()
    }

    const eventsUnsubRef = useRef<(() => void) | undefined>(undefined)
    // Subscribe / start the SSE stream exactly once per mount. init() runs
    // on EVERY render (see helper.tsx), so doing this in the render body
    // would stack a new subscription per render, each with its own private
    // event queue — duplicated events and leaked handlers.
    useEffect(() => {
      if (typeof window !== "undefined") return
      let cancelled = false
      if (props.events) {
        void props.events.subscribe(handleEvent).then((unsub) => {
          if (cancelled) {
            // Unmounted before the subscription resolved — tear it down
            // immediately instead of leaking the handler.
            unsub?.()
            return
          }
          eventsUnsubRef.current = unsub
        })
      } else if (props.enableSSE) {
        startSSE()
      }
      // Abort on unmount to prevent SSE/orphan-handler leaks.
      return () => {
        cancelled = true
        eventsUnsubRef.current?.()
        sseRef.current?.abort()
        abort.abort()
      }
    }, [])

    return {
      client: sdk,
      directory: props.directory,
      event: emitter,
      fetch:
        props.fetch ??
        globalThis.fetch?.bind(globalThis) ??
        (() => Promise.reject(new Error("no fetch"))),
      url: props.url,
    }
  },
})
