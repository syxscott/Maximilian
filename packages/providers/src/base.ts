/**
 * Provider base interface.
 * All LLM providers MUST implement this contract.
 *
 * Adding a new provider = implement this interface + register in registry.ts.
 * No business logic changes required.
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant"
  content: string
}

export interface ChatOptions {
  model?: string
  temperature?: number
  maxTokens?: number
  stopSequences?: string[]
  jsonMode?: boolean
  /** Abort signal for cancelling this specific call. */
  signal?: AbortSignal
  /**
   * Reasoning/thinking effort level (借鉴 deepseek-harness).
   * Supported by DeepSeek and compatible providers.
   * 'off' | 'low' | 'medium' | 'high' | 'max'
   */
  reasoningEffort?: ReasoningEffort
  /**
   * Resolve the API key for this specific call (借鉴 deepseek-harness per-request key resolution).
   * When provided, called once per request to get the current key.
   * Allows dynamic key rotation without restarting the provider.
   */
  getApiKey?: () => Promise<string>
  /**
   * Override the stream idle timeout for this specific call (借鉴 deepseek-harness idleWatchdog).
   * Defaults to provider-level setting. Only applies to streaming calls.
   * In milliseconds; must be positive.
   */
  streamIdleTimeoutMs?: number
}

/** Reasoning effort level for models that support it (借鉴 deepseek-harness). */
export type ReasoningEffort = "off" | "low" | "medium" | "high" | "max"

export interface ChatResponse {
  content: string
  model: string
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
    /**
     * Tokens served from provider-side prompt cache. Anthropic reports this
     * separately as `cache_read_input_tokens`; OpenAI reports it under
     * `prompt_tokens_details.cached_tokens` (cache reads are *included* in
     * `prompt_tokens` for OpenAI-style protocols — use `getFreshInputTokens`
     * to normalize). Optional because not every provider/model supports it.
     */
    cacheReadTokens?: number
    /**
     * Tokens written into provider-side prompt cache. Anthropic reports
     * `cache_creation_input_tokens`; OpenAI-style protocols do not
     * distinguish cache creation, so this is typically 0 for those.
     */
    cacheCreationTokens?: number
    /**
     * Tokens consumed by reasoning/thinking (借鉴 deepseek-harness).
     * DeepSeek and compatible providers report this separately.
     */
    reasoningTokens?: number
  }
  finishReason?: string
  raw?: unknown
}

export interface ChatChunk {
  delta: string
  done: boolean
  finishReason?: string
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
    cacheReadTokens?: number
    cacheCreationTokens?: number
    reasoningTokens?: number
  }
  raw?: unknown
}

export interface EmbeddingResponse {
  embeddings: number[][]
  model: string
  usage?: {
    promptTokens: number
    totalTokens: number
  }
}

export interface Provider {
  /** Unique provider id, e.g. "openai", "anthropic", "openrouter". */
  readonly id: string

  /** Display name for UI. */
  readonly name: string

  /** Default model to use when caller doesn't specify one. */
  readonly defaultModel: string

  /** Non-streaming chat completion. */
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse>

  /** Streaming chat completion. Yields deltas. */
  stream(messages: ChatMessage[], options?: ChatOptions): AsyncIterable<ChatChunk>

  /** Optional embeddings. Not all providers support this. */
  embeddings?(input: string | string[], model?: string): Promise<EmbeddingResponse>

  /** Lightweight health check; should not perform a real API call. */
  isConfigured(): boolean
}

/** Circuit breaker state exposed for monitoring endpoints. */
export interface CircuitBreakerStats {
  state: "closed" | "open" | "half-open"
  failures: number
  lastFailureAt: number | undefined
  probeInFlight: boolean
}

/** Optional interface for providers wrapped with circuit breaker. */
export interface CircuitBreakerProvider extends Provider {
  /** Get current circuit breaker statistics. */
  getCircuitBreakerStats?(): CircuitBreakerStats
  /** Reset the circuit breaker (transitions to half-open on next attempt). */
  resetCircuitBreaker?(): void
}

// Re-exports from dedicated modules (借鉴 deepseek-harness)

export {
  isContextWindowExceededError,
  isQuotaExceededError,
  isHarnessError,
  errorChain,
} from "./error-utils.js"
export type { ApiKeyCheck, ApiKeyRejection } from "./api-key.js"
export { normalizeApiKey } from "./api-key.js"
export type { RetryPolicyConfig, ResolvedRetryPolicy, BackoffConfig } from "./retry-policy.js"
export { resolveRetryPolicy } from "./retry-policy.js"
export type { LlmError } from "./llm-error.js"

// Error classification lives in its own module (body-aware variant + vendor
// code tables + trace-id capture, MiniMax-MCP-JS/cli borrowing); the
// status-only classifier moved there and is re-exported here so the
// historical `from "./base.js"` import path keeps working.
export {
  httpErrorCode,
  classifyProviderError,
  classifyProviderErrorBody,
  pickTraceId,
  extractVendorErrorCode,
  MINIMAX_ERROR_CODES,
} from "./error-classification.js"
export type {
  VendorErrorCodeEntry,
  VendorErrorCodeTable,
  ProviderErrorFacts,
  ClassifiedProviderError,
} from "./error-classification.js"

/** Error type for provider failures. */
export class ProviderError extends Error {
  /**
   * Vendor trace/request id captured from the response headers
   * (e.g. MiniMax `trace-id`) — mirrors the LlmFailure.requestId shape in
   * llm-error.ts so support tickets can be correlated on either path.
   */
  public readonly requestId?: string
  /**
   * Explicit retryability verdict from body-aware classification
   * (undefined = not classified; heuristics decide at the retry layer).
   */
  public readonly retryable?: boolean

  constructor(
    public readonly providerId: string,
    public readonly statusCode: number | undefined,
    message: string,
    public readonly cause?: unknown,
    public readonly code?: string,
    requestId?: string,
    retryable?: boolean,
  ) {
    super(`[${providerId}] ${message}`)
    this.name = "ProviderError"
    this.requestId = requestId
    this.retryable = retryable
  }
}
