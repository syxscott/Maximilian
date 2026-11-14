/**
 * Public surface for the formats module — generic Provider implementations
 * keyed by ApiFormat.
 *
 * Consumers (registry) import `createProviderForFormat` to wire any preset
 * up without knowing which class backs it.
 */

export { OpenAIChatProvider } from "./openai-chat.js"
export type { OpenAIChatConfig } from "./openai-chat.js"
export { AnthropicMessagesProvider } from "./anthropic.js"
export type { AnthropicMessagesConfig } from "./anthropic.js"
export { GeminiNativeProvider } from "./gemini-native.js"
export type { GeminiNativeConfig } from "./gemini-native.js"
export { OpenAIResponsesProvider } from "./openai-responses.js"
export type { OpenAIResponsesConfig } from "./openai-responses.js"

import type { Provider } from "../base.js"
import { OpenAIChatProvider } from "./openai-chat.js"
import { AnthropicMessagesProvider } from "./anthropic.js"
import { GeminiNativeProvider } from "./gemini-native.js"
import { OpenAIResponsesProvider } from "./openai-responses.js"
import type { ApiFormat } from "../presets/types.js"
import { assertFormatAdmission } from "../format-capabilities.js"
import type { ApiFormatCapability } from "../format-capabilities.js"

/**
 * Factory input — all generic providers accept this shape.
 */
export interface ProviderFactoryConfig {
  id: string
  name: string
  apiKey: string
  baseURL: string
  defaultModel: string
  defaultMaxTokens?: number
  defaultTemperature?: number
  /**
   * Capabilities the caller REQUIRES from this provider (OpenAgentCore
   * harnessconfig Declaration borrowing). Admission consults the same
   * apiFormat Declaration the runtime gates read — a provider whose
   * declaration does not include a required capability is refused here,
   * not built half-working.
   */
  requires?: readonly ApiFormatCapability[]
}

/**
 * Build a Provider from a (preset × env) pair, dispatching on apiFormat.
 *
 * Unknown apiFormat is a programmer error — surfaces immediately at startup
 * rather than silently producing a misconfigured provider.
 */
export function createProviderForFormat(
  apiFormat: ApiFormat,
  config: ProviderFactoryConfig,
): Provider {
  // Declaration-gated admission (harnessconfig borrowing): required
  // capabilities are checked against the single Declaration — the effective
  // set (declared minus runtime-narrowed) — so a narrowed capability also
  // refuses admission.
  if (config.requires && config.requires.length > 0) {
    assertFormatAdmission(apiFormat, config.requires)
  }
  switch (apiFormat) {
    case "openai_chat":
      return new OpenAIChatProvider(config)
    case "anthropic":
      return new AnthropicMessagesProvider(config)
    case "gemini_native":
      return new GeminiNativeProvider(config)
    case "openai_responses":
      return new OpenAIResponsesProvider(config)
    default: {
      const exhaustive: never = apiFormat
      throw new Error(`Unsupported apiFormat: ${String(exhaustive)}`)
    }
  }
}
