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

import Anthropic from "@anthropic-ai/sdk";
import { withSpan } from "@max/telemetry";
import type {
  ChatChunk,
  ChatMessage,
  ChatOptions,
  ChatResponse,
  Provider,
} from "../base.js";
import { ProviderError } from "../base.js";

export interface AnthropicMessagesConfig {
  id: string;
  name: string;
  apiKey: string;
  baseURL?: string;
  defaultModel: string;
  /** Default max_tokens; Anthropic requires this field — defaults to 4096. */
  defaultMaxTokens?: number;
  defaultTemperature?: number;
}

export class AnthropicMessagesProvider implements Provider {
  readonly id: string;
  readonly name: string;
  readonly defaultModel: string;
  private readonly client: Anthropic;
  private readonly defaultMaxTokens: number;
  private readonly defaultTemperature: number;

  constructor(config: AnthropicMessagesConfig) {
    if (!config.apiKey) {
      throw new Error(
        `AnthropicMessagesProvider(${config.id}): apiKey is required`,
      );
    }
    this.id = config.id;
    this.name = config.name;
    this.defaultModel = config.defaultModel;
    this.defaultMaxTokens = config.defaultMaxTokens ?? 4096;
    this.defaultTemperature = config.defaultTemperature ?? 0.7;
    this.client = new Anthropic({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    });
  }

  isConfigured(): boolean {
    return Boolean(this.client.apiKey);
  }

  private splitMessages(messages: ChatMessage[]): {
    system: string;
    rest: { role: "user" | "assistant"; content: string }[];
  } {
    const systemMessages = messages.filter((m) => m.role === "system");
    const rest = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));
    return {
      system: systemMessages.map((m) => m.content).join("\n\n"),
      rest,
    };
  }

  async chat(
    messages: ChatMessage[],
    options: ChatOptions = {},
  ): Promise<ChatResponse> {
    const model = options.model ?? this.defaultModel;
    return withSpan(
      "llm.chat",
      async (span) => {
        span?.setAttribute("llm.provider", this.id);
        span?.setAttribute("llm.model", model);
        span?.setAttribute("llm.apiFormat", "anthropic");
        span?.setAttribute("llm.messageCount", messages.length);
        try {
          const { system, rest } = this.splitMessages(messages);
          const response = await this.client.messages.create({
            model,
            system: system || undefined,
            messages: rest,
            temperature: options.temperature ?? this.defaultTemperature,
            max_tokens: options.maxTokens ?? this.defaultMaxTokens,
            stop_sequences: options.stopSequences,
          });
          const textBlock = response.content.find((b) => b.type === "text");
          const content =
            textBlock && textBlock.type === "text" ? textBlock.text : "";
          // Anthropic SDK's `Usage` type predates prompt caching; the runtime
          // payload includes `cache_creation_input_tokens` and
          // `cache_read_input_tokens` whenever caching is in effect.
          const usageExt = response.usage as
            | (typeof response.usage & {
                cache_creation_input_tokens?: number;
                cache_read_input_tokens?: number;
              })
            | undefined;
          const promptTokens = usageExt?.input_tokens ?? 0;
          const completionTokens = usageExt?.output_tokens ?? 0;
          const cacheReadTokens = usageExt?.cache_read_input_tokens ?? 0;
          const cacheCreationTokens =
            usageExt?.cache_creation_input_tokens ?? 0;
          if (usageExt) {
            span?.setAttribute("llm.promptTokens", promptTokens);
            span?.setAttribute("llm.completionTokens", completionTokens);
            if (cacheReadTokens) {
              span?.setAttribute("llm.cacheReadTokens", cacheReadTokens);
            }
            if (cacheCreationTokens) {
              span?.setAttribute("llm.cacheCreationTokens", cacheCreationTokens);
            }
          }
          return {
            content,
            model: response.model,
            usage: {
              promptTokens,
              completionTokens,
              totalTokens: promptTokens + completionTokens,
              cacheReadTokens,
              cacheCreationTokens,
            },
            finishReason: response.stop_reason ?? undefined,
            raw: response,
          };
        } catch (err) {
          throw new ProviderError(
            this.id,
            (err as { status?: number }).status,
            (err as Error).message ?? "Unknown error",
            err,
          );
        }
      },
      { "llm.provider": this.id, "llm.model": model },
    );
  }

  async *stream(
    messages: ChatMessage[],
    options: ChatOptions = {},
  ): AsyncIterable<ChatChunk> {
    try {
      const { system, rest } = this.splitMessages(messages);
      const stream = await this.client.messages.create({
        model: options.model ?? this.defaultModel,
        system: system || undefined,
        messages: rest,
        temperature: options.temperature ?? this.defaultTemperature,
        max_tokens: options.maxTokens ?? this.defaultMaxTokens,
        stream: true,
      });
      for await (const event of stream) {
        if (
          event.type === "content_block_delta" &&
          event.delta.type === "text_delta"
        ) {
          yield { delta: event.delta.text, done: false, raw: event };
        }
      }
      yield { delta: "", done: true };
    } catch (err) {
      throw new ProviderError(
        this.id,
        (err as { status?: number }).status,
        (err as Error).message ?? "Stream error",
        err,
      );
    }
  }
}