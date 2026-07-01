/**
 * DeepSeek Provider.
 * DeepSeek exposes an OpenAI-compatible chat API at https://api.deepseek.com/v1,
 * so we reuse the OpenAI client via composition — same pattern as OpenRouter.
 *
 * Models:
 *   - deepseek-chat       (V3, general purpose, low cost)
 *   - deepseek-reasoner   (R1, chain-of-thought reasoning)
 */

import type { Provider } from "./base.js";
import { OpenAIProvider, type OpenAIConfig } from "./openai.js";

export type DeepSeekConfig = Omit<OpenAIConfig, "baseURL"> & {
  baseURL?: string;
};

export class DeepSeekProvider implements Provider {
  readonly id = "deepseek";
  readonly name = "DeepSeek";
  readonly defaultModel: string;
  private delegate: OpenAIProvider;

  constructor(config: DeepSeekConfig) {
    this.defaultModel = config.defaultModel ?? "deepseek-chat";
    this.delegate = new OpenAIProvider({
      apiKey: config.apiKey,
      baseURL: config.baseURL ?? "https://api.deepseek.com/v1",
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