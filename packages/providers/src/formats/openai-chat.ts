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

import OpenAI from "openai";
import { withSpan } from "@max/telemetry";
import type {
  ChatChunk,
  ChatMessage,
  ChatOptions,
  ChatResponse,
  EmbeddingResponse,
  Provider,
} from "../base.js";
import { ProviderError } from "../base.js";

export interface OpenAIChatConfig {
  id: string;
  name: string;
  apiKey: string;
  baseURL: string;
  defaultModel: string;
  /** Override default max_tokens; defaults to 4096. */
  defaultMaxTokens?: number;
  /** Override default temperature; defaults to 0.7. */
  defaultTemperature?: number;
}

export class OpenAIChatProvider implements Provider {
  readonly id: string;
  readonly name: string;
  readonly defaultModel: string;
  private readonly client: OpenAI;
  private readonly defaultMaxTokens: number;
  private readonly defaultTemperature: number;

  constructor(config: OpenAIChatConfig) {
    if (!config.apiKey) {
      throw new Error(
        `OpenAIChatProvider(${config.id}): apiKey is required`,
      );
    }
    this.id = config.id;
    this.name = config.name;
    this.defaultModel = config.defaultModel;
    this.defaultMaxTokens = config.defaultMaxTokens ?? 4096;
    this.defaultTemperature = config.defaultTemperature ?? 0.7;
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: normalizeBaseURL(config.baseURL),
    });
  }

  isConfigured(): boolean {
    return Boolean(this.client.apiKey);
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
        span?.setAttribute("llm.apiFormat", "openai_chat");
        span?.setAttribute("llm.messageCount", messages.length);
        try {
          const response = await this.client.chat.completions.create({
            model,
            messages: messages.map((m) => ({
              role: m.role,
              content: m.content,
            })),
            temperature: options.temperature ?? this.defaultTemperature,
            max_tokens: options.maxTokens ?? this.defaultMaxTokens,
            stop: options.stopSequences,
            response_format: options.jsonMode
              ? { type: "json_object" }
              : undefined,
          });
          const choice = response.choices[0];
          if (!choice) {
            throw new ProviderError(
              this.id,
              200,
              "No completion choice returned",
            );
          }
          if (response.usage) {
            span?.setAttribute(
              "llm.promptTokens",
              response.usage.prompt_tokens,
            );
            span?.setAttribute(
              "llm.completionTokens",
              response.usage.completion_tokens,
            );
            const cached = (
              response.usage as {
                prompt_tokens_details?: { cached_tokens?: number };
              }
            ).prompt_tokens_details?.cached_tokens;
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
                    (
                      response.usage as {
                        prompt_tokens_details?: { cached_tokens?: number };
                      }
                    ).prompt_tokens_details?.cached_tokens ?? 0,
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
      const stream = await this.client.chat.completions.create({
        model: options.model ?? this.defaultModel,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        temperature: options.temperature ?? this.defaultTemperature,
        max_tokens: options.maxTokens ?? this.defaultMaxTokens,
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
        err,
      );
    }
  }

  async embeddings(
    input: string | string[],
    model = "text-embedding-3-small",
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

/**
 * Normalize a baseURL:
 *   - strip trailing slash
 *   - append `/v1` only if the path is empty or just `/`
 *
 * Presets already include the `/v1` suffix for OpenAI Chat endpoints; this
 * is a defensive fallback for malformed input.
 */
function normalizeBaseURL(raw: string): string {
  let url = raw.trim().replace(/\/+$/, "");
  // If the path is empty, default to /v1 (the OpenAI protocol root)
  const slash = url.indexOf("/", url.indexOf("//") + 2);
  if (slash === url.length - 1 || slash === -1) {
    url += "/v1";
  }
  return url;
}