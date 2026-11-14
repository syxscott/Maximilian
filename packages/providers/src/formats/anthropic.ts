/**
 * Generic Anthropic Messages provider.
 *
 * Implements the Provider interface against any HTTP endpoint that exposes
 * Anthropic's /v1/messages protocol. Covers Anthropic's first-party API
 * plus Chinese routers (Shengsuanyun, ClaudeAPI, ClaudeCN, ...) that
 * expose an Anthropic-compatible path to surface Claude behind their
 * aggregation services.
 *
 * Implementation note: We reuse the official `@anthropic-ai/sdk` and point
 * its baseURL at the preset's endpoint. The SDK only needs to know the
 * URL — auth, retries, and streaming work uniformly.
 *
 * Note: Anthropic API differs from OpenAI:
 *   - system is a top-level field, not a message role
 *   - max_tokens is REQUIRED
 */

import Anthropic from "@anthropic-ai/sdk"
import { withSpan } from "@max/telemetry"
import type { ChatChunk, ChatMessage, ChatOptions, ChatResponse, Provider } from "../base.js"
import { ProviderError } from "../base.js"
import { wireStopSequences } from "../capability-predicates.js"
import { declarationForFormat } from "../format-capabilities.js"
import { gateUsageShape } from "../usage.js"

export interface AnthropicMessagesConfig {
  id: string
  name: string
  apiKey: string
  baseURL?: string
  defaultModel: string
  /** Default max_tokens; Anthropic requires this field — defaults to 4096. */
  defaultMaxTokens?: number
  defaultTemperature?: number
}

/**
 * Raw wire usage record of the Anthropic Messages protocol. The SDK's typed
 * `Usage` predates prompt caching; the runtime payload carries the cache
 * counters alongside the base pair whenever caching is in effect.
 */
interface AnthropicUsageWire {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

export class AnthropicMessagesProvider implements Provider {
  readonly id: string
  readonly name: string
  readonly defaultModel: string
  private readonly client: Anthropic
  private readonly defaultMaxTokens: number
  private readonly defaultTemperature: number

  constructor(config: AnthropicMessagesConfig) {
    if (!config.apiKey) {
      throw new Error(`AnthropicMessagesProvider(${config.id}): apiKey is required`)
    }
    this.id = config.id
    this.name = config.name
    this.defaultModel = config.defaultModel
    // 限额映射 declaration (OpenAgentCore harnessconfig borrowing): the
    // anthropic wire REQUIRES max_tokens on every request — the fallback
    // value lives in the apiFormat Declaration, next to the requirement it
    // exists to satisfy, not as a bare literal here.
    const declaration = declarationForFormat("anthropic")
    this.defaultMaxTokens = config.defaultMaxTokens ?? declaration.maxOutputTokensFallback ?? 4096
    this.defaultTemperature = config.defaultTemperature ?? 0.7
    this.client = new Anthropic({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    })
  }

  isConfigured(): boolean {
    return Boolean(this.client.apiKey)
  }

  private splitMessages(messages: ChatMessage[]): {
    system: string
    rest: { role: "user" | "assistant"; content: string }[]
  } {
    const systemMessages = messages.filter((m) => m.role === "system")
    const rest = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }))
    return {
      system: systemMessages.map((m) => m.content).join("\n\n"),
      rest,
    }
  }

  async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<ChatResponse> {
    const model = options.model ?? this.defaultModel
    return withSpan(
      "llm.chat",
      async (span) => {
        span?.setAttribute("llm.provider", this.id)
        span?.setAttribute("llm.model", model)
        span?.setAttribute("llm.apiFormat", "anthropic")
        span?.setAttribute("llm.messageCount", messages.length)
        try {
          const { system, rest } = this.splitMessages(messages)
          const response = await this.client.messages.create({
            model,
            system: system || undefined,
            messages: rest,
            temperature: options.temperature ?? this.defaultTemperature,
            max_tokens: options.maxTokens ?? this.defaultMaxTokens,
            // Capability gate (crewAI supports_stop_words borrowing): omit
            // the parameter entirely for model families that reject it.
            stop_sequences: wireStopSequences(model, options.stopSequences, "anthropic"),
          })
          const textBlock = response.content.find((b) => b.type === "text")
          const content = textBlock && textBlock.type === "text" ? textBlock.text : ""
          // Anthropic SDK's `Usage` type predates prompt caching; the runtime
          // payload includes `cache_creation_input_tokens` and
          // `cache_read_input_tokens` whenever caching is in effect.
          const usageExt = response.usage as
            (typeof response.usage & AnthropicUsageWire) | undefined
          // Self-consistency gate (OpenAgentCore sessions/usage.go
          // MeasuredUsage borrowing): an incomplete or inconsistent breakdown
          // is reported as UNKNOWN (undefined), never zero-filled accounting.
          // Anthropic's cache counters sit outside input_tokens — the
          // "exclusive" cache semantics waive the cached ≤ input bound.
          const usage = gateUsageShape(usageExt, { cacheSemantics: "exclusive" })
          if (usage) {
            span?.setAttribute("llm.promptTokens", usage.promptTokens)
            span?.setAttribute("llm.completionTokens", usage.completionTokens)
            if (usage.cacheReadTokens) {
              span?.setAttribute("llm.cacheReadTokens", usage.cacheReadTokens)
            }
            if (usage.cacheCreationTokens) {
              span?.setAttribute("llm.cacheCreationTokens", usage.cacheCreationTokens)
            }
          }
          return {
            content,
            model: response.model,
            usage,
            // stop_reason passthrough — includes safety refusals
            // (`stop_reason: "refusal"`, deepseek chat-demo reply.ts
            // settleReply borrowing). Newer API versions emit it even though
            // this SDK version's typed union predates the value; the runtime
            // string flows through untouched.
            finishReason: response.stop_reason ?? undefined,
            raw: response,
          }
        } catch (err) {
          throw new ProviderError(
            this.id,
            (err as { status?: number }).status,
            (err as Error).message ?? "Unknown error",
            err,
          )
        }
      },
      { "llm.provider": this.id, "llm.model": model },
    )
  }

  async *stream(messages: ChatMessage[], options: ChatOptions = {}): AsyncIterable<ChatChunk> {
    try {
      const { system, rest } = this.splitMessages(messages)
      const stream = await this.client.messages.create({
        model: options.model ?? this.defaultModel,
        system: system || undefined,
        messages: rest,
        temperature: options.temperature ?? this.defaultTemperature,
        max_tokens: options.maxTokens ?? this.defaultMaxTokens,
        stream: true,
      })
      // stop_reason passthrough (deepseek chat-demo reply.ts borrowing): the
      // terminal reason — including safety refusals — arrives on the
      // message_delta event and must reach finishReason like the
      // non-streaming path does.
      let stopReason: string | undefined
      // Streaming usage accumulation (aligned with formats/openai-chat.ts):
      // message_start carries the complete input-side usage and message_delta
      // the CUMULATIVE output_tokens. Dropping either left the streaming
      // path's token accounting at zero, so both are captured and merged
      // into every chunk from the moment they are known.
      let startUsage: AnthropicUsageWire | undefined
      let outputTokens: number | undefined
      const accumulatedUsage = (): AnthropicUsageWire | undefined => {
        if (!startUsage) return undefined
        return outputTokens === undefined
          ? { ...startUsage }
          : { ...startUsage, output_tokens: outputTokens }
      }
      const gatedUsage = (): ChatChunk["usage"] =>
        gateUsageShape(accumulatedUsage(), { cacheSemantics: "exclusive" })
      for await (const event of stream) {
        if (event.type === "message_start") {
          startUsage = (event.message as { usage?: AnthropicUsageWire } | undefined)?.usage
        }
        if (event.type === "message_delta") {
          stopReason = event.delta.stop_reason ?? undefined
          const deltaUsage = (event as { usage?: { output_tokens?: number } }).usage
          if (deltaUsage && typeof deltaUsage.output_tokens === "number") {
            outputTokens = deltaUsage.output_tokens
          }
        }
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          yield {
            delta: event.delta.text,
            done: false,
            finishReason: stopReason,
            usage: gatedUsage(),
            raw: event,
          }
        }
      }
      yield { delta: "", done: true, finishReason: stopReason, usage: gatedUsage() }
    } catch (err) {
      throw new ProviderError(
        this.id,
        (err as { status?: number }).status,
        (err as Error).message ?? "Stream error",
        err,
      )
    }
  }
}
