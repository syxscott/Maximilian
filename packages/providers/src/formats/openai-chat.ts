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
import { ProviderError } from "../base.js"
import { classifyProviderErrorBody, errorFactsFromUnknown } from "../error-classification.js"
import { wireStopSequences } from "../capability-predicates.js"
import { gateUsageShape } from "../usage.js"

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
            // Capability gate (crewAI supports_stop_words borrowing): model
            // families that reject `stop` with a 400 (Bedrock openai.*) get
            // the parameter omitted; the client-side fallback truncates.
            stop: wireStopSequences(model, options.stopSequences, "openai_chat"),
            response_format,
            ...(Object.keys(extra).length > 0 ? { extra_body: extra } : {}),
          } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming)
          const choice = response.choices[0]
          if (!choice) {
            throw new ProviderError(this.id, 200, "No completion choice returned")
          }
          // Refusal mapping (deepseek chat-demo reply.ts settleReply
          // borrowing): OpenAI surfaces a safety refusal as a non-empty
          // assistant `refusal` field while `finish_reason` stays "stop" —
          // normalize it to finishReason "refusal" so downstream settles the
          // turn as refused. Other finishReasons pass through unchanged.
          const refusal = choice.message?.refusal
          const finishReason =
            typeof refusal === "string" && refusal !== ""
              ? "refusal"
              : (choice.finish_reason ?? undefined)
          // Self-consistency gate (OpenAgentCore sessions/usage.go
          // MeasuredUsage borrowing): OpenAI-style protocols fold cached
          // tokens INSIDE prompt_tokens — the "inclusive" cache semantics
          // enforce cached ≤ input and total = input + output. An
          // inconsistent or incomplete breakdown is reported as UNKNOWN
          // (undefined), never as zero-filled accounting.
          const usage = gateUsageShape(response.usage, { cacheSemantics: "inclusive" })
          if (usage) {
            span?.setAttribute("llm.promptTokens", usage.promptTokens)
            span?.setAttribute("llm.completionTokens", usage.completionTokens)
            if (usage.cacheReadTokens) {
              span?.setAttribute("llm.cacheReadTokens", usage.cacheReadTokens)
            }
            if (usage.reasoningTokens) {
              span?.setAttribute("llm.reasoningTokens", usage.reasoningTokens)
            }
          }
          return {
            content: choice.message?.content ?? "",
            model: response.model,
            usage,
            finishReason,
            raw: response,
          }
        } catch (err) {
          // Body-aware classification (MiniMax-MCP-JS api.ts + cli
          // mapApiErrorBase borrowing): vendor codes from the error body /
          // trailing message suffix drive the stable code + retryable
          // verdict, and the trace-id header is captured into the error so
          // support tickets carry it. Falls back to the status/message
          // heuristics when the body carries nothing.
          const facts = errorFactsFromUnknown(err)
          const verdict = classifyProviderErrorBody(facts)
          throw new ProviderError(
            this.id,
            facts.status,
            facts.message ?? "Unknown error",
            err,
            verdict.code,
            verdict.requestId,
            verdict.retryable,
          )
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
      let refusalSeen = false
      let usage: ChatChunk["usage"] | undefined

      for await (const chunk of stream) {
        armIdleTimeout() // Reset idle timer on each chunk
        const choice = chunk.choices[0]
        const delta = choice?.delta?.content ?? ""
        // Refusal mapping (deepseek chat-demo reply.ts settleReply
        // borrowing): streamed refusals arrive as non-empty
        // `delta.refusal` text while finish_reason stays "stop" — once a
        // refusal delta is seen it wins over any later finish_reason.
        const refusalDelta = choice?.delta?.refusal
        if (typeof refusalDelta === "string" && refusalDelta !== "") {
          refusalSeen = true
        }
        finishReason = refusalSeen ? "refusal" : (choice?.finish_reason ?? finishReason)
        if (chunk.usage) {
          // Streaming usage accumulation with the same self-consistency gate
          // as the non-streaming path: a chunk whose usage fails the gate
          // leaves the last good measurement in place rather than poisoning
          // the accumulated record (OpenAgentCore MeasuredUsage borrowing).
          const gated = gateUsageShape(chunk.usage, { cacheSemantics: "inclusive" })
          if (gated) usage = gated
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
      const facts = errorFactsFromUnknown(err)
      const verdict = classifyProviderErrorBody(facts)
      // Body-aware classification (MiniMax-MCP-JS api.ts + cli
      // mapApiErrorBase borrowing) — same wiring as the non-streaming catch.
      throw new ProviderError(
        this.id,
        facts.status,
        facts.message ?? "Stream error",
        err,
        verdict.code,
        verdict.requestId,
        verdict.retryable,
      )
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
