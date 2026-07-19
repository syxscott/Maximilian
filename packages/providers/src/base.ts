/**
 * Provider base interface.
 * All LLM providers MUST implement this contract.
 *
 * Adding a new provider = implement this interface + register in registry.ts.
 * No business logic changes required.
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  stopSequences?: string[];
  jsonMode?: boolean;
  /** Abort signal for cancelling this specific call. */
  signal?: AbortSignal;
}

export interface ChatResponse {
  content: string;
  model: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    /**
     * Tokens served from provider-side prompt cache. Anthropic reports this
     * separately as `cache_read_input_tokens`; OpenAI reports it under
     * `prompt_tokens_details.cached_tokens` (cache reads are *included* in
     * `prompt_tokens` for OpenAI-style protocols — use `getFreshInputTokens`
     * to normalize). Optional because not every provider/model supports it.
     */
    cacheReadTokens?: number;
    /**
     * Tokens written into provider-side prompt cache. Anthropic reports
     * `cache_creation_input_tokens`; OpenAI-style protocols do not
     * distinguish cache creation, so this is typically 0 for those.
     */
    cacheCreationTokens?: number;
  };
  finishReason?: string;
  raw?: unknown;
}

export interface ChatChunk {
  delta: string;
  done: boolean;
  raw?: unknown;
}

export interface EmbeddingResponse {
  embeddings: number[][];
  model: string;
  usage?: {
    promptTokens: number;
    totalTokens: number;
  };
}

export interface Provider {
  /** Unique provider id, e.g. "openai", "anthropic", "openrouter". */
  readonly id: string;

  /** Display name for UI. */
  readonly name: string;

  /** Default model to use when caller doesn't specify one. */
  readonly defaultModel: string;

  /** Non-streaming chat completion. */
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse>;

  /** Streaming chat completion. Yields deltas. */
  stream(
    messages: ChatMessage[],
    options?: ChatOptions
  ): AsyncIterable<ChatChunk>;

  /** Optional embeddings. Not all providers support this. */
  embeddings?(
    input: string | string[],
    model?: string
  ): Promise<EmbeddingResponse>;

  /** Lightweight health check; should not perform a real API call. */
  isConfigured(): boolean;
}

/** Circuit breaker state exposed for monitoring endpoints. */
export interface CircuitBreakerStats {
  state: "closed" | "open" | "half-open";
  failures: number;
  lastFailureAt: number | undefined;
  probeInFlight: boolean;
}

/** Optional interface for providers wrapped with circuit breaker. */
export interface CircuitBreakerProvider extends Provider {
  /** Get current circuit breaker statistics. */
  getCircuitBreakerStats?(): CircuitBreakerStats;
  /** Reset the circuit breaker (transitions to half-open on next attempt). */
  resetCircuitBreaker?(): void;
}

/** Error type for provider failures. */
export class ProviderError extends Error {
  constructor(
    public readonly providerId: string,
    public readonly statusCode: number | undefined,
    message: string,
    public readonly cause?: unknown
  ) {
    super(`[${providerId}] ${message}`);
    this.name = "ProviderError";
  }
}