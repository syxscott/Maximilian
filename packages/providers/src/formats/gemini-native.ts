/**
 * Generic Google Gemini (Native generateContent) provider.
 *
 * Implements the Provider interface against the
 *   POST /v1beta/models/{model}:generateContent
 * endpoint family. Used by Google's first-party Gemini API and by Gemini
 * proxies that speak the same dialect.
 *
 * Implementation note: We do NOT pull in `@google/generative-ai` because the
 * SDK is large and we only need chat + stream. Plain `fetch` keeps the
 * surface small and lets us thread the API key as a query parameter
 * (which is how the Gemini API expects it).
 *
 * API contract:
 *   - URL:    {baseUrl}/models/{model}:generateContent?key={apiKey}
 *   - Method: POST
 *   - Body:   { contents: [...], systemInstruction?: {...}, generationConfig: {...} }
 */

import { withSpan } from "@max/telemetry";
import type {
  ChatChunk,
  ChatMessage,
  ChatOptions,
  ChatResponse,
  Provider,
} from "../base.js";
import { ProviderError } from "../base.js";

export interface GeminiNativeConfig {
  id: string;
  name: string;
  apiKey: string;
  baseURL: string;
  defaultModel: string;
  defaultMaxTokens?: number;
  defaultTemperature?: number;
}

interface GeminiPart {
  text: string;
}
interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}
interface GeminiRequest {
  contents: GeminiContent[];
  systemInstruction?: { parts: GeminiPart[] };
  generationConfig?: {
    temperature?: number;
    maxOutputTokens?: number;
    stopSequences?: string[];
  };
}
interface GeminiResponse {
  modelVersion?: string;
  contents?: Array<{ role?: string; parts?: GeminiPart[] }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
    cachedContentTokenCount?: number;
  };
  candidates?: Array<{
    finishReason?: string;
    content?: { parts?: GeminiPart[] };
  }>;
}

export class GeminiNativeProvider implements Provider {
  readonly id: string;
  readonly name: string;
  readonly defaultModel: string;
  private readonly apiKey: string;
  private readonly baseURL: string;
  private readonly defaultMaxTokens: number;
  private readonly defaultTemperature: number;

  constructor(config: GeminiNativeConfig) {
    if (!config.apiKey) {
      throw new Error(
        `GeminiNativeProvider(${config.id}): apiKey is required`,
      );
    }
    this.id = config.id;
    this.name = config.name;
    this.defaultModel = config.defaultModel;
    this.apiKey = config.apiKey;
    this.baseURL = config.baseURL.replace(/\/+$/, "");
    this.defaultMaxTokens = config.defaultMaxTokens ?? 4096;
    this.defaultTemperature = config.defaultTemperature ?? 0.7;
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  private splitMessages(messages: ChatMessage[]): {
    system: string;
    contents: GeminiContent[];
  } {
    const systemMessages = messages.filter((m) => m.role === "system");
    const contents: GeminiContent[] = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        // Gemini uses "model" instead of "assistant"
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));
    return {
      system: systemMessages.map((m) => m.content).join("\n\n"),
      contents,
    };
  }

  private buildRequest(
    messages: ChatMessage[],
    options: ChatOptions,
  ): GeminiRequest {
    const { system, contents } = this.splitMessages(messages);
    const req: GeminiRequest = { contents };
    if (system) {
      req.systemInstruction = { parts: [{ text: system }] };
    }
    const cfg: GeminiRequest["generationConfig"] = {};
    const temp = options.temperature ?? this.defaultTemperature;
    if (temp !== undefined) cfg.temperature = temp;
    const max = options.maxTokens ?? this.defaultMaxTokens;
    if (max !== undefined) cfg.maxOutputTokens = max;
    if (options.stopSequences?.length) {
      cfg.stopSequences = options.stopSequences;
    }
    if (Object.keys(cfg).length > 0) req.generationConfig = cfg;
    return req;
  }

  private endpoint(model: string): string {
    return `${this.baseURL}/models/${encodeURIComponent(model)}:generateContent`;
  }

  private streamEndpoint(model: string): string {
    return `${this.baseURL}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
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
        span?.setAttribute("llm.apiFormat", "gemini_native");
        span?.setAttribute("llm.messageCount", messages.length);
        try {
          const url = `${this.endpoint(model)}?key=${encodeURIComponent(this.apiKey)}`;
          const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(this.buildRequest(messages, options)),
          });
          if (!response.ok) {
            const errText = await response.text();
            throw new ProviderError(
              this.id,
              response.status,
              `Gemini HTTP ${response.status}: ${errText.slice(0, 500)}`,
            );
          }
          const data = (await response.json()) as GeminiResponse;
          const text =
            data.candidates?.[0]?.content?.parts
              ?.map((p) => p.text)
              .join("") ?? "";
          const usage = data.usageMetadata;
          if (usage) {
            if (usage.promptTokenCount !== undefined) {
              span?.setAttribute("llm.promptTokens", usage.promptTokenCount);
            }
            if (usage.candidatesTokenCount !== undefined) {
              span?.setAttribute(
                "llm.completionTokens",
                usage.candidatesTokenCount,
              );
            }
            if (usage.cachedContentTokenCount) {
              span?.setAttribute(
                "llm.cacheReadTokens",
                usage.cachedContentTokenCount,
              );
            }
          }
          return {
            content: text,
            model: data.modelVersion ?? model,
            usage: usage
              ? {
                  promptTokens: usage.promptTokenCount ?? 0,
                  completionTokens: usage.candidatesTokenCount ?? 0,
                  totalTokens:
                    usage.totalTokenCount ??
                    (usage.promptTokenCount ?? 0) +
                      (usage.candidatesTokenCount ?? 0),
                  cacheReadTokens: usage.cachedContentTokenCount ?? 0,
                  cacheCreationTokens: 0,
                }
              : undefined,
            finishReason: data.candidates?.[0]?.finishReason ?? undefined,
            raw: data,
          };
        } catch (err) {
          if (err instanceof ProviderError) throw err;
          throw new ProviderError(
            this.id,
            undefined,
            (err as Error).message ?? "Unknown Gemini error",
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
    const model = options.model ?? this.defaultModel;
    const url = `${this.streamEndpoint(model)}&key=${encodeURIComponent(this.apiKey)}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(this.buildRequest(messages, options)),
    });
    if (!response.ok || !response.body) {
      throw new ProviderError(
        this.id,
        response.status,
        `Gemini stream HTTP ${response.status}`,
      );
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // SSE frames are separated by blank lines
        let frameEnd: number;
        while ((frameEnd = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, frameEnd);
          buffer = buffer.slice(frameEnd + 2);
          // Each frame may have multiple "data: " lines; we only care about the payload
          for (const line of frame.split("\n")) {
            if (!line.startsWith("data:")) continue;
            const json = line.slice(5).trim();
            if (!json) continue;
            try {
              const obj = JSON.parse(json) as GeminiResponse;
              const text =
                obj.candidates?.[0]?.content?.parts
                  ?.map((p) => p.text)
                  .join("") ?? "";
              if (text) yield { delta: text, done: false, raw: obj };
            } catch {
              // Malformed SSE chunk — skip
            }
          }
        }
      }
      yield { delta: "", done: true };
    } finally {
      reader.releaseLock();
    }
  }
}