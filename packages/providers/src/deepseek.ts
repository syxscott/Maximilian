/**
 * DeepSeekProvider — thin compatibility wrapper over OpenAIChatProvider.
 * DeepSeek exposes an OpenAI-compatible /v1/chat/completions endpoint, so
 * the generic class is a perfect fit. Kept as a separate class so existing
 * imports still work and to lock in the DeepSeek-specific defaults.
 */

import {
  OpenAIChatProvider,
  type OpenAIChatConfig,
} from "./formats/openai-chat.js";

export interface DeepSeekConfig {
  apiKey: string;
  baseURL?: string;
  defaultModel?: string;
}

export class DeepSeekProvider extends OpenAIChatProvider {
  constructor(config: DeepSeekConfig) {
    super({
      id: "deepseek",
      name: "DeepSeek",
      apiKey: config.apiKey,
      baseURL: config.baseURL ?? "https://api.deepseek.com/v1",
      defaultModel: config.defaultModel ?? "deepseek-chat",
    } satisfies OpenAIChatConfig);
  }
}