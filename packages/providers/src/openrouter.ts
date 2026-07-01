/**
 * OpenRouter Provider.
 * OpenRouter exposes an OpenAI-compatible API, so we reuse the OpenAI client
 * with a different base URL.
 */

import type { Provider } from "./base.js";
import { OpenAIProvider, type OpenAIConfig } from "./openai.js";

export type OpenRouterConfig = Omit<OpenAIConfig, "baseURL"> & {
  baseURL?: string;
};

export class OpenRouterProvider implements Provider {
  readonly id = "openrouter";
  readonly name = "OpenRouter";
  readonly defaultModel: string;
  private delegate: OpenAIProvider;

  constructor(config: OpenRouterConfig) {
    this.defaultModel = config.defaultModel ?? "anthropic/claude-3.5-haiku";
    this.delegate = new OpenAIProvider({
      apiKey: config.apiKey,
      baseURL: config.baseURL ?? "https://openrouter.ai/api/v1",
      defaultModel: this.defaultModel,
    });
  }

  isConfigured(): boolean {
    return this.delegate.isConfigured();
  }

  chat(
    messages: Parameters<Provider["chat"]>[0],
    options?: Parameters<Provider["chat"]>[1]
  ): ReturnType<Provider["chat"]> {
    return this.delegate.chat(messages, options);
  }

  stream(
    messages: Parameters<Provider["stream"]>[0],
    options?: Parameters<Provider["stream"]>[1]
  ): ReturnType<Provider["stream"]> {
    return this.delegate.stream(messages, options);
  }

  embeddings(
    input: string | string[],
    model?: string
  ): ReturnType<NonNullable<Provider["embeddings"]>> {
    return this.delegate.embeddings!(input, model);
  }
}