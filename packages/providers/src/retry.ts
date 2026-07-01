import type { Provider, ChatMessage, ChatOptions, ChatResponse } from "./base.js";

export interface RetryOptions {
  /** Max retry attempts (default: 3) */
  maxAttempts?: number;
  /** Base delay in ms for exponential backoff (default: 1000) */
  baseDelay?: number;
  /** Cap on per-attempt backoff in ms (default: 30000) */
  maxDelay?: number;
  /** Add randomness to avoid thundering herd (default: true) */
  jitter?: boolean;
  /** HTTP status codes that should trigger a retry */
  retryableStatuses?: number[];
}

const DEFAULT_RETRYABLE_STATUSES = [429, 500, 502, 503, 504];

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
  } = options ?? {};

  async function retryChat(messages: ChatMessage[], opts?: ChatOptions): Promise<ChatResponse> {
    let lastError: unknown;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        return await provider.chat(messages, opts);
      } catch (err) {
        lastError = err;
        if (!isRetryable(err, retryableStatuses) || attempt === maxAttempts - 1) {
          throw err;
        }
        const delay = computeBackoff(attempt, baseDelay, maxDelay, jitter);
        await sleep(delay);
      }
    }
    throw lastError;
  }

  return {
    get id() { return provider.id; },
    get name() { return provider.name; },
    get defaultModel() { return provider.defaultModel; },
    chat: retryChat,
    stream: provider.stream.bind(provider),
    embeddings: provider.embeddings?.bind(provider),
    isConfigured: provider.isConfigured.bind(provider),
  };
}

/** Compute backoff delay (exported for testing). */
export function computeBackoff(attempt: number, baseDelay: number, maxDelay: number, jitter: boolean): number {
  const ceiling = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
  return jitter ? Math.floor(Math.random() * ceiling) : ceiling;
}

function isRetryable(err: unknown, retryableStatuses: number[]): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    // Network errors
    if (msg.includes("econnrefused") || msg.includes("econnreset") || msg.includes("etimedout") || msg.includes("fetch failed")) {
      return true;
    }
    // ProviderError with status code
    if ("statusCode" in err && typeof (err as { statusCode: unknown }).statusCode === "number") {
      return retryableStatuses.includes((err as { statusCode: number }).statusCode);
    }
    // Rate limit errors
    if (msg.includes("rate limit") || msg.includes("429") || msg.includes("too many requests")) {
      return true;
    }
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
