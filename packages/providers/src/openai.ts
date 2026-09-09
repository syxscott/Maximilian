/**
 * OpenAIProvider — thin compatibility wrapper over the generic
 * OpenAIChatProvider. Preserves the original exported shape for downstream
 * consumers that construct it directly. New code should prefer the generic
 * class via the registry / preset pipeline.
 */

import {
  OpenAIChatProvider,
  type OpenAIChatConfig,
} from "./formats/openai-chat.js";

export interface OpenAIConfig {
  apiKey: string;
  baseURL?: string;
  defaultModel?: string;
}

export class OpenAIProvider extends OpenAIChatProvider {
  constructor(config: OpenAIConfig) {
    super({
      id: "openai",
      name: "OpenAI",
      apiKey: config.apiKey,
      baseURL: config.baseURL ?? "https://api.openai.com/v1",
      defaultModel: config.defaultModel ?? "gpt-4o-mini",
    } satisfies OpenAIChatConfig);
  }
}