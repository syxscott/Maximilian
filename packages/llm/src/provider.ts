// Provider definition — plain TypeScript
// Derived from OpenCode packages/llm/src/provider.ts

import type { ProviderID, ModelID } from "./types.js"
import type { ModelDef, GenerationOptions, HttpOptions } from "./options.js"

// ── Route Defaults ──

export interface RouteDefaults {
  readonly generation?: GenerationOptions
  readonly http?: HttpOptions
  readonly providerOptions?: Record<string, Record<string, unknown>>
}

// ── Provider Definition ──

export type ModelFactory = (id: string | ModelID, options?: RouteDefaults) => ModelDef

export interface ProviderDefinition {
  readonly id: ProviderID
  readonly model: ModelFactory
  readonly apis?: Record<string, ModelFactory>
}

export function makeProvider(definition: ProviderDefinition): ProviderDefinition {
  return Object.freeze(definition)
}

// ── Well-Known Provider IDs ──

export const PROVIDER_IDS = {
  anthropic: "anthropic" as ProviderID,
  openai: "openai" as ProviderID,
  google: "google" as ProviderID,
  googleVertex: "google-vertex" as ProviderID,
  githubCopilot: "github-copilot" as ProviderID,
  amazonBedrock: "amazon-bedrock" as ProviderID,
  azure: "azure" as ProviderID,
  openrouter: "openrouter" as ProviderID,
  mistral: "mistral" as ProviderID,
  xai: "xai" as ProviderID,
  deepseek: "deepseek" as ProviderID,
  groq: "groq" as ProviderID,
  together: "together" as ProviderID,
  fireworks: "fireworks" as ProviderID,
  cerebras: "cerebras" as ProviderID,
  cloudflare: "cloudflare" as ProviderID,
} as const

// ── OpenAI-Compatible Profile ──

export interface OpenAICompatibleProfile {
  readonly provider: string
  readonly baseURL: string
}

export const OPENAI_COMPATIBLE_PROFILES: Record<string, OpenAICompatibleProfile> = {
  baseten: { provider: "baseten", baseURL: "https://bridge.baseten.co/v1" },
  cerebras: { provider: "cerebras", baseURL: "https://api.cerebras.ai/v1" },
  deepinfra: { provider: "deepinfra", baseURL: "https://api.deepinfra.com/v1/openai" },
  deepseek: { provider: "deepseek", baseURL: "https://api.deepseek.com/v1" },
  fireworks: { provider: "fireworks", baseURL: "https://api.fireworks.ai/inference/v1" },
  groq: { provider: "groq", baseURL: "https://api.groq.com/openai/v1" },
  openrouter: { provider: "openrouter", baseURL: "https://openrouter.ai/api/v1" },
  togetherai: { provider: "togetherai", baseURL: "https://api.together.xyz/v1" },
  xai: { provider: "xai", baseURL: "https://api.x.ai/v1" },
}

// ── Provider Info (application-level) ──

export interface ProviderInfo {
  readonly id: string
  readonly name: string
  readonly source: "env" | "config" | "custom" | "api"
  readonly env: ReadonlyArray<string>
  readonly key?: string
  readonly options?: Record<string, unknown>
  readonly models: Record<string, ModelInfo>
}

export interface ModelInfo {
  readonly id: string
  readonly providerID: string
  readonly name: string
  readonly family?: string
  readonly capabilities?: ModelCapabilities
  readonly cost?: ModelCost
  readonly limit?: ModelLimits
  readonly status?: "active" | "alpha" | "beta" | "deprecated"
  readonly releaseDate?: string
}

export interface ModelCapabilities {
  readonly temperature?: boolean
  readonly reasoning?: boolean
  readonly attachment?: boolean
  readonly toolCall?: boolean
  readonly inputModalities?: ReadonlyArray<string>
  readonly outputModalities?: ReadonlyArray<string>
  readonly interleaved?: boolean
}

export interface ModelCost {
  readonly input?: number
  readonly output?: number
  readonly cache?: number
}

export interface ModelLimits {
  readonly context?: number
  readonly input?: number
  readonly output?: number
}
