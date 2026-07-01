/**
 * Anthropic Provider.
 * Implements the unified Provider interface using @anthropic-ai/sdk.
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
} from "./base.js";
import { ProviderError } from "./base.js";

export interface AnthropicConfig {
  apiKey: string;
  baseURL?: string;
  defaultModel?: string;
}

export class AnthropicProvider implements Provider {
  readonly id = "anthropic";
  readonly name = "Anthropic";
  readonly defaultModel: string;

  private client: Anthropic;

  constructor(config: AnthropicConfig) {
    if (!config.apiKey) {
      throw new Error("AnthropicProvider: apiKey is required");
    }
    this.client = new Anthropic({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    });
    this.defaultModel = config.defaultModel ?? "claude-3-5-haiku-20241022";
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
    options: ChatOptions = {}
  ): Promise<ChatResponse> {
    const model = options.model ?? this.defaultModel;
    return withSpan(
      "llm.chat",
      async (span) => {
        span?.setAttribute("llm.provider", this.id);
        span?.setAttribute("llm.model", model);
        span?.setAttribute("llm.messageCount", messages.length);
        try {
          const { system, rest } = this.splitMessages(messages);
          const response = await this.client.messages.create({
            model,
            system: system || undefined,
            messages: rest,
            temperature: options.temperature ?? 0.7,
            max_tokens: options.maxTokens ?? 4096,
            stop_sequences: options.stopSequences,
          });
          const textBlock = response.content.find((b) => b.type === "text");
          const content = textBlock && textBlock.type === "text" ? textBlock.text : "";
          // Anthropic SDK's `Usage` type predates prompt caching; the runtime
          // payload includes `cache_creation_input_tokens` and
          // `cache_read_input_tokens` whenever caching is in effect.
          const usageExt = response.usage as typeof response.usage & {
            cache_creation_input_tokens?: number;
            cache_read_input_tokens?: number;
          };
          if (response.usage) {
            span?.setAttribute("llm.promptTokens", response.usage.input_tokens);
            span?.setAttribute("llm.completionTokens", response.usage.output_tokens);
            if (usageExt.cache_read_input_tokens) {
              span?.setAttribute("llm.cacheReadTokens", usageExt.cache_read_input_tokens);
            }
            if (usageExt.cache_creation_input_tokens) {
              span?.setAttribute("llm.cacheCreationTokens", usageExt.cache_creation_input_tokens);
            }
          }
          return {
            content,
            model: response.model,
            usage: {
              promptTokens: response.usage.input_tokens,
              completionTokens: response.usage.output_tokens,
              totalTokens:
                response.usage.input_tokens + response.usage.output_tokens,
              cacheReadTokens: usageExt.cache_read_input_tokens ?? 0,
              cacheCreationTokens: usageExt.cache_creation_input_tokens ?? 0,
            },
            finishReason: response.stop_reason ?? undefined,
            raw: response,
          };
        } catch (err) {
          throw new ProviderError(
            this.id,
            (err as { status?: number }).status,
            (err as Error).message ?? "Unknown error",
            err
          );
        }
      },
      { "llm.provider": this.id, "llm.model": model },
    );
  }

  async *stream(
    messages: ChatMessage[],
    options: ChatOptions = {}
  ): AsyncIterable<ChatChunk> {
    try {
      const { system, rest } = this.splitMessages(messages);
      const stream = await this.client.messages.create({
        model: options.model ?? this.defaultModel,
        system: system || undefined,
        messages: rest,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens ?? 4096,
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
        err
      );
    }
  }
}