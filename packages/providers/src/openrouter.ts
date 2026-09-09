/**
 * OpenRouterProvider — thin compatibility wrapper over OpenAIChatProvider.
 * OpenRouter exposes the standard OpenAI Chat Completions protocol, so the
 * generic class is a perfect fit. Kept as a separate class so existing
 * imports still work and to lock in the OpenRouter-specific defaults.
 */

import {
  OpenAIChatProvider,
  type OpenAIChatConfig,
} from "./formats/openai-chat.js";

export interface OpenRouterConfig {
  apiKey: string;
  baseURL?: string;
  defaultModel?: string;
}

export class OpenRouterProvider extends OpenAIChatProvider {
  constructor(config: OpenRouterConfig) {
    super({
      id: "openrouter",
      name: "OpenRouter",
      apiKey: config.apiKey,
      baseURL: config.baseURL ?? "https://openrouter.ai/api/v1",
      defaultModel: config.defaultModel ?? "anthropic/claude-3.5-haiku",
    } satisfies OpenAIChatConfig);
  }
}