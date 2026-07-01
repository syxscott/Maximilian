/**
 * OpenAI Provider.
 * Implements the unified Provider interface using the official OpenAI SDK.
 */

import OpenAI from "openai";
import { withSpan } from "@max/telemetry";
import type {
  ChatChunk,
  ChatMessage,
  ChatOptions,
  ChatResponse,
  EmbeddingResponse,
  Provider,
} from "./base.js";
import { ProviderError } from "./base.js";

export interface OpenAIConfig {
  apiKey: string;
  baseURL?: string;
  defaultModel?: string;
}

export class OpenAIProvider implements Provider {
  readonly id = "openai";
  readonly name = "OpenAI";
  readonly defaultModel: string;

  private client: OpenAI;

  constructor(config: OpenAIConfig) {
    if (!config.apiKey) {
      throw new Error("OpenAIProvider: apiKey is required");
    }
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    });
    this.defaultModel = config.defaultModel ?? "gpt-4o-mini";
  }

  isConfigured(): boolean {
    return Boolean(this.client.apiKey);
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
          const response = await this.client.chat.completions.create({
            model,
            messages: messages.map((m) => ({ role: m.role, content: m.content })),
            temperature: options.temperature ?? 0.7,
            max_tokens: options.maxTokens ?? 4096,
            stop: options.stopSequences,
            response_format: options.jsonMode
              ? { type: "json_object" }
              : undefined,
          });
          const choice = response.choices[0];
          if (!choice) {
            throw new ProviderError(this.id, 200, "No completion choice returned");
          }
          if (response.usage) {
            span?.setAttribute("llm.promptTokens", response.usage.prompt_tokens);
            span?.setAttribute("llm.completionTokens", response.usage.completion_tokens);
            // OpenAI-style protocols include cached tokens *inside* prompt_tokens;
            // surface them as cacheReadTokens for downstream cost/hit-rate math.
            const cached = (response.usage as { prompt_tokens_details?: { cached_tokens?: number } })
              .prompt_tokens_details?.cached_tokens;
            if (cached) span?.setAttribute("llm.cacheReadTokens", cached);
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
                    (response.usage as { prompt_tokens_details?: { cached_tokens?: number } })
                      .prompt_tokens_details?.cached_tokens ?? 0,
                  cacheCreationTokens: 0,
                }
              : undefined,
            finishReason: choice.finish_reason ?? undefined,
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
      const stream = await this.client.chat.completions.create({
        model: options.model ?? this.defaultModel,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens ?? 4096,
        stream: true,
      });
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content ?? "";
        yield { delta, done: false, raw: chunk };
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

  async embeddings(
    input: string | string[],
    model = "text-embedding-3-small"
  ): Promise<EmbeddingResponse> {
    const inputs = Array.isArray(input) ? input : [input];
    const response = await this.client.embeddings.create({
      model,
      input: inputs,
    });
    return {
      embeddings: response.data.map((d) => d.embedding),
      model: response.model,
      usage: response.usage
        ? {
            promptTokens: response.usage.prompt_tokens,
            totalTokens: response.usage.total_tokens,
          }
        : undefined,
    };
  }
}