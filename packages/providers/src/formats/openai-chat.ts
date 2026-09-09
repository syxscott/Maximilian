/**
 * Generic OpenAI Chat Completions provider.
 *
 * Implements the Provider interface against any HTTP endpoint that exposes
 * OpenAI's /v1/chat/completions and /v1/embeddings protocol. Covers the
 * vast majority of presets — most Chinese + international 1P vendors and
 * almost every aggregator proxy speaks this dialect.
 *
 * Implementation note: We reuse the official `openai` SDK and just point
 * its baseURL at the preset's endpoint. That gets us streaming, retries,
 * type safety, and tracking headers for free.
 */

import OpenAI from "openai"
import { withSpan } from "@max/telemetry"
import type {
  ChatChunk,
  ChatMessage,
  ChatOptions,
  ChatResponse,
  EmbeddingResponse,
  Provider,
} from "../base.js"
import { ProviderError, classifyProviderError } from "../base.js"

export interface OpenAIChatConfig {
  id: string
  name: string
  apiKey: string
  baseURL: string
  defaultModel: string
  /** Override default max_tokens; defaults to 4096. */
  defaultMaxTokens?: number
  /** Override default temperature; defaults to 0.7. */
  defaultTemperature?: number
}

export class OpenAIChatProvider implements Provider {
  readonly id: string
  readonly name: string
  readonly defaultModel: string
  private readonly client: OpenAI
  private readonly defaultMaxTokens: number
  private readonly defaultTemperature: number

  constructor(config: OpenAIChatConfig) {
    if (!config.apiKey) {
      throw new Error(`OpenAIChatProvider(${config.id}): apiKey is required`)
    }
    this.id = config.id
    this.name = config.name
    this.defaultModel = config.defaultModel
    this.defaultMaxTokens = config.defaultMaxTokens ?? 4096
    this.defaultTemperature = config.defaultTemperature ?? 0.7
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: normalizeBaseURL(config.baseURL),
    })
  }

  isConfigured(): boolean {
    return Boolean(this.client.apiKey)
  }

  async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<ChatResponse> {
    const model = options.model ?? this.defaultModel
    return withSpan(
      "llm.chat",
      async (span) => {
        span?.setAttribute("llm.provider", this.id)
        span?.setAttribute("llm.model", model)
        span?.setAttribute("llm.apiFormat", "openai_chat")
        span?.setAttribute("llm.messageCount", messages.length)
        try {
          // Build extra body for provider-specific fields (e.g. DeepSeek thinking mode)
          const extra: Record<string, unknown> = {}
          if (options.reasoningEffort !== undefined) {
            const effort = options.reasoningEffort
            if (effort === "off") {
              extra.thinking = { type: "disabled" as const }
            } else if (effort === "high" || effort === "max") {
              extra.thinking = { type: "enabled" as const }
              extra.reasoning_effort = effort
            }
            // 'low' and 'medium' are not supported by DeepSeek; omit rather than throw
            // so generic OpenAI-compatible providers continue to work.
          }
          const response_format = options.jsonMode ? { type: "json_object" as const } : undefined
          // Per-request API key resolution (借鉴 deepseek-harness).
          // Note: OpenAI SDK does not expose per-call apiKey override in RequestOptions;
          // when getApiKey is provided the caller must ensure the provider is configured
          // with a compatible key or use a provider that supports dynamic resolution.
          const response = await this.client.chat.completions.create({
            model,
            messages: messages.map((m) => ({
              role: m.role,
              content: m.content,
            })),
            temperature: options.temperature ?? this.defaultTemperature,
            max_tokens: options.maxTokens ?? this.defaultMaxTokens,
            stop: options.stopSequences,
            response_format,
            ...(Object.keys(extra).length > 0 ? { extra_body: extra } : {}),
          } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming)
          const choice = response.choices[0]
          if (!choice) {
            throw new ProviderError(this.id, 200, "No completion choice returned")
          }
          if (response.usage) {
            span?.setAttribute("llm.promptTokens", response.usage.prompt_tokens)
            span?.setAttribute("llm.completionTokens", response.usage.completion_tokens)
            const cached = (
              response.usage as {
                prompt_tokens_details?: { cached_tokens?: number }
              }
            ).prompt_tokens_details?.cached_tokens
            if (cached) span?.setAttribute("llm.cacheReadTokens", cached)
          }
          // Reasoning tokens (借鉴 deepseek-harness WireUsage.completion_tokens_details.reasoning_tokens)
          const reasoningTokens = (
            response.usage as {
              completion_tokens_details?: { reasoning_tokens?: number }
            }
          ).completion_tokens_details?.reasoning_tokens
          if (reasoningTokens !== undefined) {
            span?.setAttribute("llm.reasoningTokens", reasoningTokens)
          }
          return {
            content: choice.message?.content ?? "",
            model: response.model,
            usage: response.usage
              ? {
                  promptTokens: response.usage.prompt_tokens,
                  completionTokens: response.usage.completion_tokens,
                  totalTokens: response.usage.total_tokens,
                  cacheReadTokens:
                    (
                      response.usage as {
                        prompt_tokens_details?: { cached_tokens?: number }
                      }
                    ).prompt_tokens_details?.cached_tokens ?? 0,
                  cacheCreationTokens: 0,
                  reasoningTokens: reasoningTokens ?? 0,
                }
              : undefined,
            finishReason: choice.finish_reason ?? undefined,
            raw: response,
          }
        } catch (err) {
          const status = (err as { status?: number }).status
          const message = (err as Error).message ?? "Unknown error"
          const { code } = classifyProviderError(status, message)
          throw new ProviderError(this.id, status, message, err, code)
        }
      },
      { "llm.provider": this.id, "llm.model": model },
    )
  }

  async *stream(messages: ChatMessage[], options: ChatOptions = {}): AsyncIterable<ChatChunk> {
    // Stream idle watchdog (借鉴 deepseek-harness idleWatchdog)
    const DEFAULT_IDLE_TIMEOUT_MS = 300_000
    const idleTimeoutMs = options.streamIdleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS
    const consumer = new AbortController()
    const upstream =
      options.signal === undefined
        ? consumer.signal
        : AbortSignal.any([options.signal, consumer.signal])

    let idleTimer: ReturnType<typeof setTimeout> | undefined
    let idleTimeout: AbortController | undefined
    let exhausted = false

    const armIdleTimeout = (): void => {
      if (idleTimer !== undefined) clearTimeout(idleTimer)
      idleTimeout?.abort()
      idleTimeout = new AbortController()
      idleTimer = setTimeout(() => {
        idleTimeout!.abort()
      }, idleTimeoutMs)
    }

    const clearIdleTimeout = (): void => {
      if (idleTimer !== undefined) {
        clearTimeout(idleTimer)
        idleTimer = undefined
      }
      idleTimeout?.abort()
      idleTimeout = undefined
    }

    try {
      // Per-request API key resolution note:
      // The OpenAI SDK does not support per-call apiKey override via RequestOptions.
      // When getApiKey is set, the caller should use a provider configured with
      // a compatible apiKey or rely on baseURL auth headers instead.
      void options.getApiKey

      // Build extra body for provider-specific fields (e.g. DeepSeek thinking mode)
      const extra: Record<string, unknown> = {}
      if (options.reasoningEffort !== undefined) {
        const effort = options.reasoningEffort
        if (effort === "off") {
          extra.thinking = { type: "disabled" as const }
        } else if (effort === "high" || effort === "max") {
          extra.thinking = { type: "enabled" as const }
          extra.reasoning_effort = effort
        }
      }

      const stream = await this.client.chat.completions.create({
        model: options.model ?? this.defaultModel,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        temperature: options.temperature ?? this.defaultTemperature,
        max_tokens: options.maxTokens ?? this.defaultMaxTokens,
        stream: true as const,
        ...(Object.keys(extra).length > 0 ? { extra_body: extra } : {}),
      } as OpenAI.Chat.ChatCompletionCreateParamsStreaming)

      let finishReason: string | undefined
      let usage: ChatChunk["usage"] | undefined

      for await (const chunk of stream) {
        armIdleTimeout() // Reset idle timer on each chunk
        const choice = chunk.choices[0]
        const delta = choice?.delta?.content ?? ""
        finishReason = choice?.finish_reason ?? finishReason
        if (chunk.usage) {
          const reasoningTokens = (
            chunk.usage as {
              completion_tokens_details?: { reasoning_tokens?: number }
            }
          ).completion_tokens_details?.reasoning_tokens
          usage = {
            promptTokens: chunk.usage.prompt_tokens,
            completionTokens: chunk.usage.completion_tokens,
            totalTokens: chunk.usage.total_tokens,
            cacheReadTokens: (
              chunk.usage as {
                prompt_tokens_details?: { cached_tokens?: number }
              }
            ).prompt_tokens_details?.cached_tokens,
            cacheCreationTokens: 0,
            reasoningTokens: reasoningTokens ?? 0,
          }
        }
        yield { delta, done: false, finishReason, usage, raw: chunk }
      }
      exhausted = true
      yield { delta: "", done: true, finishReason, usage }
    } catch (err) {
      // Check if it was an idle timeout
      if (idleTimeout?.signal.aborted) {
        throw new ProviderError(
          this.id,
          408,
          `Stream idle timeout after ${idleTimeoutMs}ms`,
          err,
          "TIMEOUT",
        )
      }
      if ((err as { name?: string }).name === "AbortError") {
        throw new ProviderError(this.id, 0, "Stream aborted", err, "ABORTED")
      }
      const status = (err as { status?: number }).status
      const message = (err as Error).message ?? "Stream error"
      const { code } = classifyProviderError(status, message)
      throw new ProviderError(this.id, status, message, err, code)
    } finally {
      consumer.abort()
      clearIdleTimeout()
    }
  }

  async embeddings(
    input: string | string[],
    model = "text-embedding-3-small",
  ): Promise<EmbeddingResponse> {
    const inputs = Array.isArray(input) ? input : [input]
    const response = await this.client.embeddings.create({
      model,
      input: inputs,
    })
    return {
      embeddings: response.data.map((d) => d.embedding),
      model: response.model,
      usage: response.usage
        ? {
            promptTokens: response.usage.prompt_tokens,
            totalTokens: response.usage.total_tokens,
          }
        : undefined,
    }
  }
}

/**
 * Normalize a baseURL:
 *   - strip trailing slash
 *   - append `/v1` only if the path is empty or just `/`
 *
 * Presets already include the `/v1` suffix for OpenAI Chat endpoints; this
 * is a defensive fallback for malformed input.
 */
function normalizeBaseURL(raw: string): string {
  let url = raw.trim().replace(/\/+$/, "")
  // If the path is empty, default to /v1 (the OpenAI protocol root)
  const slash = url.indexOf("/", url.indexOf("//") + 2)
  if (slash === url.length - 1 || slash === -1) {
    url += "/v1"
  }
  return url
}
