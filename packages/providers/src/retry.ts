import type {
  Provider,
  ChatMessage,
  ChatOptions,
  ChatResponse,
  ChatChunk,
  EmbeddingResponse,
} from "./base.js"

/**
 * Retry status broadcast (opencode `session/retry.ts` UI-semantics
 * borrowing): every backed-off attempt is reported with the attempt number,
 * the resolved delay and a human-readable action, so dashboards/TUIs can
 * show "retrying in 30s (attempt 2 of 5)" instead of a silent hang.
 */
export interface ProviderRetryStatus {
  providerId: string
  /** Attempt number that just failed (0-based). */
  attempt: number
  maxAttempts: number
  /** Resolved backoff in ms (server retry-after wins when provided). */
  delayMs: number
  /** Epoch ms when the next attempt fires. */
  nextRetryAt: number
  /** Human-readable action for UI display. */
  action: string
  /** Raw error message. */
  reason: string
}

export interface RetryOptions {
  /** Max retry attempts (default: 3) */
  maxAttempts?: number
  /** Base delay in ms for exponential backoff (default: 1000) */
  baseDelay?: number
  /** Cap on per-attempt backoff in ms (default: 30000) */
  maxDelay?: number
  /** Add randomness to avoid thundering herd (default: true) */
  jitter?: boolean
  /** HTTP status codes that should trigger a retry */
  retryableStatuses?: number[]
  /**
   * 借鉴 opencode - SessionRetry.parseRetryAfter
   * 调用方在每次失败后注入最新响应 headers(若有);优先使用 header 中的
   * `retry-after` / `retry-after-ms` 决定退避时长。
   */
  headers?: () => Record<string, string | undefined> | undefined
  /**
   * 借鉴 opencode - retry status with UI semantics. Called before each
   * backoff sleep so callers can surface progress to users.
   */
  onRetryStatus?: (status: ProviderRetryStatus) => void
}

/** Map an error to a short human action (opencode retry-action borrowing). */
export function describeRetryAction(err: unknown): string {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase()
  if (msg.includes("rate limit") || msg.includes("429") || msg.includes("too many requests")) {
    return "provider rate limit hit — waiting for capacity"
  }
  if (msg.includes("econnrefused")) return "provider unreachable — retrying connection"
  if (msg.includes("econnreset") || msg.includes("fetch failed")) {
    return "connection dropped — reconnecting"
  }
  if (msg.includes("etimedout") || msg.includes("timeout")) return "timed out — retrying"
  return "transient provider error — backing off"
}

const DEFAULT_RETRYABLE_STATUSES = [429, 500, 502, 503, 504]

/**
 * Wraps a Provider with retry logic using exponential backoff.
 * Only retries on transient errors (rate limits, server errors, network errors).
 * Does NOT retry on client errors (400, 401, 403).
 *
 * Backoff: base * 2^attempt, capped at maxDelay, optionally jittered (full-jitter).
 * Full-jitter: delay = random(0, base * 2^attempt) — proven to give lowest completion
 * time under high concurrency (AWS Architecture Blog).
 */
export function withRetry(provider: Provider, options?: RetryOptions): Provider {
  const {
    maxAttempts = 3,
    baseDelay = 1000,
    maxDelay = 30_000,
    jitter = true,
    retryableStatuses = DEFAULT_RETRYABLE_STATUSES,
  } = options ?? {}

  function emitStatus(attempt: number, delayMs: number, err: unknown): void {
    if (!options?.onRetryStatus) return
    options.onRetryStatus({
      providerId: provider.id,
      attempt,
      maxAttempts,
      delayMs,
      nextRetryAt: Date.now() + delayMs,
      action: describeRetryAction(err),
      reason: err instanceof Error ? err.message : String(err),
    })
  }

  async function retryChat(messages: ChatMessage[], opts?: ChatOptions): Promise<ChatResponse> {
    let lastError: unknown
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        return await provider.chat(messages, opts)
      } catch (err) {
        lastError = err
        if (!isRetryable(err, retryableStatuses) || attempt === maxAttempts - 1) {
          throw err
        }
        const delay = resolveDelay(attempt, baseDelay, maxDelay, jitter, options?.headers?.())
        emitStatus(attempt, delay, err)
        await sleep(delay)
      }
    }
    throw lastError
  }

  async function* retryStream(
    messages: ChatMessage[],
    opts?: ChatOptions,
  ): AsyncIterable<ChatChunk> {
    let lastError: unknown = new Error("Stream failed after all retry attempts")
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        for await (const chunk of provider.stream(messages, opts)) {
          yield chunk
        }
        // Stream completed successfully — exit the retry loop
        return
      } catch (err) {
        lastError = err
        if (!isRetryable(err, retryableStatuses) || attempt === maxAttempts - 1) {
          throw err
        }
        const delay = resolveDelay(attempt, baseDelay, maxDelay, jitter, options?.headers?.())
        emitStatus(attempt, delay, err)
        await sleep(delay)
        // Continue to next attempt
      }
    }
    throw lastError
  }

  async function retryEmbeddings(
    input: string | string[],
    model?: string,
  ): Promise<EmbeddingResponse> {
    if (!provider.embeddings) throw new Error("Provider does not support embeddings")
    let lastError: unknown
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        return await provider.embeddings(input, model)
      } catch (err) {
        lastError = err
        if (!isRetryable(err, retryableStatuses) || attempt === maxAttempts - 1) {
          throw err
        }
        const delay = resolveDelay(attempt, baseDelay, maxDelay, jitter, options?.headers?.())
        emitStatus(attempt, delay, err)
        await sleep(delay)
      }
    }
    throw lastError
  }

  return {
    get id() {
      return provider.id
    },
    get name() {
      return provider.name
    },
    get defaultModel() {
      return provider.defaultModel
    },
    chat: retryChat,
    stream: retryStream,
    embeddings: provider.embeddings ? retryEmbeddings : undefined,
    isConfigured: provider.isConfigured.bind(provider),
  }
}

/** Compute backoff delay (exported for testing). */
export function computeBackoff(
  attempt: number,
  baseDelay: number,
  maxDelay: number,
  jitter: boolean,
): number {
  const ceiling = Math.min(baseDelay * Math.pow(2, attempt), maxDelay)
  return jitter ? Math.floor(Math.random() * ceiling) : ceiling
}

/**
 * 借鉴 opencode - SessionRetry.parseRetryAfter
 * 从 response headers 中解析 retry-after / retry-after-ms / HTTP date。
 * 优先级:retry-after-ms > retry-after (秒) > retry-after (HTTP date)。
 * 都解析不出来时返回 undefined。
 */
export function parseRetryAfter(
  headers: Record<string, string | undefined> | undefined,
): number | undefined {
  if (!headers) return undefined
  const ms = headers["retry-after-ms"]
  if (ms) {
    const v = Number.parseFloat(ms)
    if (!Number.isNaN(v)) return cap(v)
  }
  const sec = headers["retry-after"]
  if (sec) {
    const v = Number.parseFloat(sec)
    if (!Number.isNaN(v)) return cap(Math.ceil(v * 1000))
    const dateMs = Date.parse(sec) - Date.now()
    if (!Number.isNaN(dateMs) && dateMs > 0) return cap(Math.ceil(dateMs))
  }
  return undefined
}

// 借鉴 opencode - RETRY_MAX_DELAY_NO_HEADERS / RETRY_MAX_DELAY
const RETRY_MAX_DELAY_NO_HEADERS = 30_000
const RETRY_MAX_DELAY = 2_147_483_647 // max 32-bit signed int

function cap(ms: number): number {
  return Math.min(ms, RETRY_MAX_DELAY)
}

/**
 * 借鉴 opencode - delay resolution: 优先使用 server 给出的 retry-after,
 * 否则用 computeBackoff(指数退避)。返回毫秒。
 */
function resolveDelay(
  attempt: number,
  baseDelay: number,
  maxDelay: number,
  jitter: boolean,
  headers: Record<string, string | undefined> | undefined,
): number {
  const serverMs = parseRetryAfter(headers)
  if (serverMs !== undefined) {
    // server 给出了重试窗口,默认尊重 server 但不超过 maxDelay 上限
    return Math.min(serverMs, maxDelay)
  }
  // 修复 HIGH 5 - 没有 server 提示时,把 baseDelay 钳到 RETRY_MAX_DELAY_NO_HEADERS
  // (借鉴 opencode - 防止本地 config 设了超大 baseDelay 后无限退避)
  const cappedBase = Math.min(baseDelay, RETRY_MAX_DELAY_NO_HEADERS)
  return computeBackoff(attempt, cappedBase, maxDelay, jitter)
}

function isRetryable(err: unknown, retryableStatuses: number[]): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase()
    // Network errors
    if (
      msg.includes("econnrefused") ||
      msg.includes("econnreset") ||
      msg.includes("etimedout") ||
      msg.includes("fetch failed")
    ) {
      return true
    }
    // ProviderError with status code
    if ("statusCode" in err && typeof (err as { statusCode: unknown }).statusCode === "number") {
      return retryableStatuses.includes((err as { statusCode: number }).statusCode)
    }
    // Rate limit errors
    if (msg.includes("rate limit") || msg.includes("429") || msg.includes("too many requests")) {
      return true
    }
  }
  return false
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
