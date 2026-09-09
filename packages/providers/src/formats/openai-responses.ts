/**
 * Generic OpenAI Responses API provider.
 *
 * Implements the Provider interface against any HTTP endpoint that exposes
 * the OpenAI Responses protocol (`POST /v1/responses`). This is the newer
 * OpenAI API used by ChatGPT Codex, the Responses SDK, and some aggregation
 * proxies (APIKEY.FUN, APINebula, SudoCode in the preset list).
 *
 * Implementation note: We reuse the official `openai` SDK; it ships a
 * `client.responses` namespace as of v4.50. We translate the unified
 * `ChatMessage[]` model to the Responses `input` array (which is a flat
 * list of typed items rather than role-tagged messages).
 *
 * Differences from OpenAI Chat Completions:
 *   - `messages` is replaced with `input`
 *   - `input` items are typed objects (`{type: "message", role, content}`)
 *   - Response `output` is an array of typed parts (text, tool_call, ...)
 */

import OpenAI from "openai";
import { withSpan } from "@max/telemetry";
import type {
  ChatChunk,
  ChatMessage,
  ChatOptions,
  ChatResponse,
  Provider,
} from "../base.js";
import { ProviderError } from "../base.js";

export interface OpenAIResponsesConfig {
  id: string;
  name: string;
  apiKey: string;
  baseURL: string;
  defaultModel: string;
  defaultMaxTokens?: number;
  defaultTemperature?: number;
}

export class OpenAIResponsesProvider implements Provider {
  readonly id: string;
  readonly name: string;
  readonly defaultModel: string;
  private readonly client: OpenAI;
  private readonly defaultMaxTokens: number;
  private readonly defaultTemperature: number;

  constructor(config: OpenAIResponsesConfig) {
    if (!config.apiKey) {
      throw new Error(
        `OpenAIResponsesProvider(${config.id}): apiKey is required`,
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

  private toInput(messages: ChatMessage[]) {
    return messages.map((m) => ({
      // Responses API uses "developer" for system instructions, but accepts
      // any role and treats it as plain message content. We collapse system
      // into user messages to avoid Responses-specific semantics.
      role: m.role === "system" ? "developer" : m.role,
      content: m.content,
    }));
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
        span?.setAttribute("llm.apiFormat", "openai_responses");
        span?.setAttribute("llm.messageCount", messages.length);
        try {
          // The OpenAI SDK exposes `.responses.create()`. Type-wise the
          // options object is permissive; we cast to `any` to avoid pulling
          // in a Responses-specific type bundle that isn't stable across
          // SDK versions.
          const response = await (
            this.client.responses as unknown as {
              create: (opts: Record<string, unknown>) => Promise<{
                model?: string;
                output?: Array<{
                  type?: string;
                  content?: Array<{
                    type?: string;
                    text?: string;
                  }>;
                }>;
                usage?: {
                  input_tokens?: number;
                  output_tokens?: number;
                  total_tokens?: number;
                };
              }>;
            }
          ).create({
            model,
            input: this.toInput(messages),
            temperature: options.temperature ?? this.defaultTemperature,
            max_output_tokens: options.maxTokens ?? this.defaultMaxTokens,
          });
          // Walk output[*].content[*].text — the first text part wins.
          let text = "";
          for (const item of response.output ?? []) {
            for (const part of item.content ?? []) {
              if (part.type === "output_text" && part.text) {
                text += part.text;
              }
            }
          }
          if (response.usage) {
            if (response.usage.input_tokens !== undefined) {
              span?.setAttribute(
                "llm.promptTokens",
                response.usage.input_tokens,
              );
            }
            if (response.usage.output_tokens !== undefined) {
              span?.setAttribute(
                "llm.completionTokens",
                response.usage.output_tokens,
              );
            }
          }
          return {
            content: text,
            model: response.model ?? model,
            usage: response.usage
              ? {
                  promptTokens: response.usage.input_tokens ?? 0,
                  completionTokens: response.usage.output_tokens ?? 0,
                  totalTokens:
                    response.usage.total_tokens ??
                    (response.usage.input_tokens ?? 0) +
                      (response.usage.output_tokens ?? 0),
                  cacheReadTokens: 0,
                  cacheCreationTokens: 0,
                }
              : undefined,
            finishReason: undefined,
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
      const stream = await (
        this.client.responses as unknown as {
          create: (opts: Record<string, unknown>) => Promise<AsyncIterable<{
            type?: string;
            delta?: string;
            text?: string;
          }>>;
        }
      ).create({
        model: options.model ?? this.defaultModel,
        input: this.toInput(messages),
        temperature: options.temperature ?? this.defaultTemperature,
        max_output_tokens: options.maxTokens ?? this.defaultMaxTokens,
        stream: true,
      });
      for await (const event of stream) {
        // Responses stream events vary by SDK version; we accept both
        // `{delta: "..."}` and `{text: "..."}` shapes.
        const delta =
          (event as { delta?: string }).delta ??
          (event as { text?: string }).text ??
          "";
        if (delta) yield { delta, done: false, raw: event };
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

function normalizeBaseURL(raw: string): string {
  let url = raw.trim().replace(/\/+$/, "");
  const slash = url.indexOf("/", url.indexOf("//") + 2);
  if (slash === url.length - 1 || slash === -1) {
    url += "/v1";
  }
  return url;
}