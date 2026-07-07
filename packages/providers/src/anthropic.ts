/**
 * AnthropicProvider — thin compatibility wrapper over the generic
 * AnthropicMessagesProvider. Preserves the original exported shape
 * (`id === "anthropic"`, `name === "Anthropic"`) for downstream consumers
 * that construct it directly. New code should prefer the generic class via
 * the registry / preset pipeline.
 */

import {
  AnthropicMessagesProvider,
  type AnthropicMessagesConfig,
} from "./formats/anthropic.js";

export interface AnthropicConfig {
  apiKey: string;
  baseURL?: string;
  defaultModel?: string;
}

export class AnthropicProvider extends AnthropicMessagesProvider {
  constructor(config: AnthropicConfig) {
    super({
      id: "anthropic",
      name: "Anthropic",
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      defaultModel: config.defaultModel ?? "claude-3-5-haiku-20241022",
    } satisfies AnthropicMessagesConfig);
  }
}