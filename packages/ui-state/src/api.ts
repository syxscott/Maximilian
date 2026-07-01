/**
 * API client that mirrors OpenCode's server SDK pattern.
 *
 * OpenCode's `@opencode-ai/sdk/v2` exposes a `createOpencodeClient(config)`
 * factory that returns an `OpencodeClient` whose methods are organised by
 * resource (e.g. `client.session.list`, `client.global.config.update`).
 * Internally it uses `hey-api` to generate a typed client over the
 * server's REST + SSE surface.
 *
 * In the React 19 / Zustand port we keep the same surface but build it from
 * a single `baseUrl` and a method map. The split into two pieces mirrors
 * OpenCode's own:
 *
 *   - `createApiClient(config)` — HTTP + SSE transport; returns a thin
 *     `client` whose methods are derived from a user-supplied method map.
 *   - `createEventStream(client, path, options)` — long-lived SSE consumer
 *     with auto-reconnect (heartbeat) and `onError` / `onEvent` callbacks.
 *
 * Consumers can either supply a concrete method map (see the example at
 * the bottom) or wrap a generated `OpencodeClient`-style object.
 */

/**
 * Minimal shape of a Zod schema so we don't depend on the package. Pass
 * any function `(value) => parsed` (Zod, Valibot, custom, etc.) and we
 * treat it identically.
 */
type SchemaLike<T> = { parse: (value: unknown) => T } | ((value: unknown) => T)

export type ApiClientConfig = {
  baseUrl: string
  directory?: string
  fetch?: typeof fetch
  signal?: AbortSignal
  headers?: Record<string, string>
  /**
   * `throwOnError` mirrors OpenCode's SDK: when true, non-2xx responses
   * raise an `ApiError` instead of returning a `{ data, error }` envelope.
   */
  throwOnError?: boolean
}

export class ApiError extends Error {
  status: number
  statusText: string
  body: unknown
  constructor(message: string, init: { status: number; statusText: string; body: unknown }) {
    super(message)
    this.name = "ApiError"
    this.status = init.status
    this.statusText = init.statusText
    this.body = init.body
  }
}

type QueryValue = string | number | boolean | undefined | null
export type QueryParams = Record<string, QueryValue | QueryValue[]>

export type RequestOptions = {
  query?: QueryParams | URLSearchParams
  body?: unknown
  headers?: Record<string, string>
  signal?: AbortSignal
  /**
   * Optional response validator. Used by the SSE consumer to validate
   * individual events against a schema (Zod or any predicate).
   */
  validate?: (value: unknown) => unknown | Promise<unknown>
  /**
   * Optional transformer applied to a parsed JSON body before returning.
   */
  transform?: <T>(value: unknown) => T | Promise<T>
}

export type ApiMethod<Args extends unknown[], Result> = ((...args: Args) => ApiCall<Result>) & {
  __args?: Args
  __result?: Result
}

export type ApiCall<Result> = Promise<{
  data: Result | null
  error: ApiError | null
  response: Response
}>

export type MethodMap = Record<string, ApiMethod<unknown[], unknown>>

export interface ApiClient<Methods extends MethodMap> {
  config: Required<Pick<ApiClientConfig, "baseUrl">> & ApiClientConfig
  url(path: string, query?: QueryParams | URLSearchParams): string
  request<Result = unknown>(
    method: string,
    path: string,
    options?: RequestOptions,
  ): Promise<{
    data: Result | null
    error: ApiError | null
    response: Response
  }>
  /**
   * Open a server-sent events stream. Returns an `EventStream` object that
   * yields typed events and exposes `start` / `stop` / `close` controls.
   */
  event<Result = unknown>(path: string, options?: EventStreamOptions<Result>): EventStream<Result>
  /**
   * Build a method from a verb + path template. The returned function
   * forwards the call to `request`.
   */
  method<Result = unknown, Args extends unknown[] = []>(
    verb: "GET" | "POST" | "PUT" | "DELETE" | "PATCH",
    path: string,
  ): ApiMethod<Args, Result>
  /**
   * Provide a method map; each entry becomes a callable on the client.
   */
  methods<M extends MethodMap>(map: M): Methods & this
  /**
   * Bind directory-scoped headers (e.g. `x-opencode-directory`).
   */
  withDirectory(directory: string): ApiClient<Methods>
}

export type EventStreamOptions<T> = {
  signal?: AbortSignal
  query?: QueryParams | URLSearchParams
  /**
   * Validate a parsed event payload. Throwing (or returning a rejected
   * promise) surfaces the error via `onError` without terminating the
   * stream.
   */
  validate?: SchemaLike<T>
  /**
   * Reconnect delay in ms. Defaults to 250ms.
   */
  reconnectDelay?: number
  /**
   * Idle timeout in ms. If no event arrives within the window, the stream
   * is reconnected. Defaults to 15000.
   */
  heartbeatTimeout?: number
  /**
   * Invoked on a single event after `validate` passes.
   */
  onEvent?: (event: T) => void
  /**
   * Invoked on transport / parse errors. The stream stays open.
   */
  onError?: (error: unknown) => void
}

export interface EventStream<T> {
  /**
   * Async iterator over events. The iterator completes when the underlying
   * fetch ends (e.g. on `stop()`).
   */
  [Symbol.asyncIterator](): AsyncIterator<T>
  start(): Promise<void>
  stop(): void
  close(): Promise<void>
}

function buildHeaders(config: ApiClientConfig, extra?: Record<string, string>): Headers {
  const headers = new Headers(extra ?? config.headers ?? {})
  if (config.directory) {
    headers.set("x-opencode-directory", encodeURIComponent(config.directory))
  }
  if (!headers.has("accept")) headers.set("accept", "application/json")
  return headers
}

function buildQuery(query: QueryParams | URLSearchParams | undefined): string {
  if (!query) return ""
  if (query instanceof URLSearchParams) {
    const s = query.toString()
    return s ? `?${s}` : ""
  }
  const usp = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue
    if (Array.isArray(v)) {
      for (const item of v) {
        if (item === undefined || item === null) continue
        usp.append(k, String(item))
      }
    } else {
      usp.append(k, String(v))
    }
  }
  const s = usp.toString()
  return s ? `?${s}` : ""
}

export function createApiClient<Methods extends MethodMap = MethodMap>(
  config: ApiClientConfig,
): ApiClient<Methods> {
  const fetchImpl = config.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args))
  const throwOnError = config.throwOnError ?? false
  let activeDirectory = config.directory

  const client: ApiClient<Methods> = {
    config: { ...config, baseUrl: config.baseUrl.replace(/\/+$/, "") },
    url(path, query) {
      const base = this.config.baseUrl
      const cleaned = path.startsWith("/") ? path : `/${path}`
      return `${base}${cleaned}${buildQuery(query)}`
    },
    async request(method, path, options) {
      const url = client.url(path, options?.query)
      const headers = buildHeaders({ ...config, directory: activeDirectory }, options?.headers)
      const init: RequestInit = {
        method,
        headers,
        body: options?.body === undefined ? undefined : JSON.stringify(options.body),
        signal: options?.signal ?? config.signal,
      }
      if (init.body) headers.set("content-type", "application/json")
      const response = await fetchImpl(url, init)
      const contentType = response.headers.get("content-type") ?? ""
      let parsed: unknown = null
      if (contentType.includes("application/json")) {
        try {
          parsed = await response.json()
        } catch {
          parsed = null
        }
      } else if (response.body) {
        try {
          parsed = await response.text()
        } catch {
          parsed = null
        }
      }
      let value: unknown = parsed
      if (options?.transform && value !== null) {
        try {
          value = await options.transform(value)
        } catch {
          value = null
        }
      }
      if (options?.validate && value !== null) {
        try {
          value = await options.validate(value)
        } catch {
          value = null
        }
      }
      if (!response.ok) {
        const err = new ApiError(`Request failed: ${method} ${url} (${response.status})`, {
          status: response.status,
          statusText: response.statusText,
          body: value,
        })
        if (throwOnError) throw err
        return { data: null, error: err, response }
      }
      return { data: value as never, error: null, response }
    },
    event(path, options) {
      return createEventStream(client, path, options)
    },
    method(verb, path) {
      const fn = ((opts?: RequestOptions) => client.request(verb, path, opts)) as ApiMethod<unknown[], unknown>
      fn.__args = []
      return fn as never
    },
    methods(map) {
      for (const [name, fn] of Object.entries(map)) {
        ;(client as unknown as Record<string, unknown>)[name] = fn
      }
      return client as unknown as Methods & ApiClient<Methods>
    },
    withDirectory(directory) {
      return createApiClient<Methods>({ ...config, directory })
    },
  }

  return client
}

/**
 * Open an SSE stream. Mirrors OpenCode's behaviour:
 *  - Auto-reconnect with configurable delay.
 *  - Idle timeout (heartbeat) aborts the current attempt and reconnects.
 *  - Yields events through an async iterator and via `onEvent`.
 *  - Buffers partial lines (`\n\n` separated).
 */
export function createEventStream<T = unknown>(
  client: Pick<ApiClient<MethodMap>, "url" | "request"> & { config: ApiClientConfig },
  path: string,
  options: EventStreamOptions<T> = {},
): EventStream<T> {
  const fetchImpl = client.config.fetch ?? fetch
  const reconnectDelay = options.reconnectDelay ?? 250
  const heartbeatTimeout = options.heartbeatTimeout ?? 15_000

  let abort = new AbortController()
  let generation = 0
  let run: Promise<void> | undefined
  let started = false
  const queue: T[] = []
  const waiters: Array<(value: IteratorResult<T>) => void> = []

  function emit(value: T) {
    const waiter = waiters.shift()
    if (waiter) waiter({ value, done: false })
    else queue.push(value)
  }

  function pump(buffer: string, text: string): string {
    const combined = buffer + text
    const chunks = combined.split("\n\n")
    const rest = chunks.pop() ?? ""
    for (const chunk of chunks) {
      const lines = chunk.split("\n")
      const dataLines: string[] = []
      let eventName: string | undefined
      for (const line of lines) {
        if (line.startsWith("data:")) dataLines.push(line.replace(/^data:\s*/, ""))
        else if (line.startsWith("event:")) eventName = line.replace(/^event:\s*/, "")
      }
      if (dataLines.length === 0) continue
      const raw = dataLines.join("\n")
      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch {
        parsed = raw
      }
      if (options.validate) {
        const fn = options.validate
        try {
          parsed = typeof fn === "function" ? (fn as (v: unknown) => T)(parsed) : (fn as { parse: (v: unknown) => T }).parse(parsed)
        } catch (err) {
          options.onError?.(err)
          continue
        }
      }
      const event = { ...(parsed as object), type: eventName } as T
      emit(event)
      try {
        options.onEvent?.(event)
      } catch (err) {
        options.onError?.(err)
      }
    }
    return rest
  }

  async function start(): Promise<void> {
    if (started) return run
    started = true
    abort = new AbortController()
    const active = ++generation
    const url = client.url(path, options.query)
    run = (async () => {
      while (!abort.signal.aborted && generation === active) {
        const attempt = new AbortController()
        const onAbort = () => attempt.abort()
        abort.signal.addEventListener("abort", onAbort)
        const idle = setTimeout(() => attempt.abort(), heartbeatTimeout)
        try {
          const headers = new Headers({ accept: "text/event-stream", "cache-control": "no-cache" })
          const response = await fetchImpl(url, {
            method: "GET",
            headers,
            credentials: "include",
            signal: attempt.signal,
          })
          if (!response.ok || !response.body) {
            throw new ApiError(`SSE failed: ${response.status} ${response.statusText}`, {
              status: response.status,
              statusText: response.statusText,
              body: null,
            })
          }
          const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
          let buffer = ""
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            buffer = pump(buffer, value)
          }
        } catch (err) {
          if (!attempt.signal.aborted) options.onError?.(err)
        } finally {
          clearTimeout(idle)
          abort.signal.removeEventListener("abort", onAbort)
        }
        if (abort.signal.aborted || generation !== active) return
        await new Promise((r) => setTimeout(r, reconnectDelay))
      }
    })()
    return run
  }

  function stop() {
    started = false
    generation++
    abort.abort()
  }

  async function close() {
    stop()
    if (run) await run.catch(() => undefined)
    while (waiters.length) {
      const w = waiters.shift()!
      w({ value: undefined as unknown as T, done: true })
    }
  }

  return {
    [Symbol.asyncIterator]() {
      return {
        next: () => {
          const next = queue.shift()
          if (next !== undefined) return Promise.resolve({ value: next, done: false })
          if (!started) void start()
          return new Promise((resolve) => waiters.push(resolve))
        },
        return: async () => {
          stop()
          return { value: undefined as unknown as T, done: true }
        },
      }
    },
    start,
    stop,
    close,
  }
}
