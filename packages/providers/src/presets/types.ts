/**
 * Provider preset type definitions.
 *
 * Borrowed from CC Switch (https://github.com/farion1231/cc-switch),
 * which maintains ~300 curated presets for Claude/Codex/Gemini IDE backends.
 * We reuse the data model (id / endpoint / apiFormat / category / partner /
 * requiresOAuth) but drop the IDE-specific fields (theme / icon / modelRoutes).
 *
 * API keys are NEVER read from or written to these objects — env vars only.
 */

export type ApiFormat =
  /** Standard OpenAI /v1/chat/completions protocol. Most widely supported. */
  | "openai_chat"
  /** Anthropic /v1/messages protocol. Used by Anthropic, Claude on Vertex/Bedrock, and many Chinese routers that expose an Anthropic-compatible path. */
  | "anthropic"
  /** Google Gemini generateContent protocol. Used by Google AI Studio and Gemini-compatible proxies. */
  | "gemini_native"
  /** OpenAI Responses API. Used by Codex-style products. */
  | "openai_responses"

export type ProviderCategory =
  /** First-party LLM provider (Anthropic, OpenAI, Google). */
  | "official"
  /** Chinese 1P LLM provider (DeepSeek, Zhipu, Kimi, ...). */
  | "china"
  /** International 1P provider (Groq, Mistral, Cohere, ...). */
  | "international"
  /** Routing / aggregation service (OpenRouter, PackyCode, ...). */
  | "aggregator"
  /** Cloud-hosted proxy (AWS Bedrock, Azure OpenAI). */
  | "cloud"
  /** User-defined custom endpoint. */
  | "custom"

/**
 * Static description of an LLM provider.
 *
 * A preset tells the registry how to wire up a Provider instance from env vars
 * — it is NOT a runtime provider itself. The registry reads `env[envKey]` and
 * builds a real Provider via the corresponding `formats/<format>.ts` class.
 */
export interface ProviderPreset {
  /** Unique slug, kebab-case. Used as Provider.id and as the DB primary key. */
  id: string
  /** Display name for UI / logs. */
  name: string
  /** Env var name containing the API key. */
  envKey: string
  /** Optional env var containing the default model override. */
  envModel?: string
  /** Wire protocol. Picks which `formats/` class to instantiate. */
  apiFormat: ApiFormat
  /** Primary base URL. Trailing slash is normalized away at runtime. */
  baseUrl: string
  /** Fallback base URLs to try in order on connection failure. */
  endpointCandidates?: string[]
  /** Default model when env var / runtime override absent. */
  defaultModel: string
  /** Provider homepage. */
  websiteUrl?: string
  /** Where to obtain an API key. */
  apiKeyUrl?: string
  /** Grouping for UI. */
  category: ProviderCategory
  /** True for first-party providers (Anthropic, OpenAI, Google). */
  isOfficial?: boolean
  /** True for partner / recommended providers (shown with a badge). */
  isPartner?: boolean
  /**
   * Requires OAuth instead of a static API key. Presets marked this way are
   * hidden from the default registry — they need a separate OAuth flow that
   * we do not yet implement. Keep the data so future work can wire it up.
   */
  requiresOAuth?: boolean
  /** Cloud-hosted, requires credentials outside the simple API key model. */
  cloudProvider?: "aws" | "azure"
  /** Hide from default registry (used for OAuth / placeholders). */
  hidden?: boolean
}