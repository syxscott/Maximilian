// Generation and model options — plain TypeScript
// Derived from OpenCode packages/llm/src/schema/options.ts

import { ModelID, ProviderID } from "./types.js"
import type { JsonSchema } from "./types.js"

export interface GenerationOptions {
  readonly maxTokens?: number
  readonly temperature?: number
  readonly topP?: number
  readonly topK?: number
  readonly frequencyPenalty?: number
  readonly presencePenalty?: number
  readonly seed?: number
  readonly stop?: ReadonlyArray<string>
}

export interface HttpOptions {
  readonly body?: Record<string, unknown>
  readonly headers?: Record<string, string>
  readonly query?: Record<string, string>
}

export type ProviderOptions = Record<string, Record<string, unknown>>

export interface CacheHint {
  readonly type: "ephemeral" | "persistent"
  readonly ttlSeconds?: number
}

export interface CachePolicyObject {
  readonly tools?: boolean
  readonly system?: boolean
  readonly messages?: "latest-user-message" | "latest-assistant" | { readonly tail: number }
  readonly ttlSeconds?: number
}

export type CachePolicy = "auto" | "none" | CachePolicyObject

export interface ModelDef {
  readonly id: ModelID
  readonly provider: ProviderID
}

export function makeModel(id: string, provider: string): ModelDef {
  return { id: ModelID(id), provider: ProviderID(provider) }
}

export function mergeGenerationOptions(
  ...items: ReadonlyArray<GenerationOptions | undefined>
): GenerationOptions | undefined {
  const defined = items.filter((i): i is GenerationOptions => i !== undefined)
  if (defined.length === 0) return undefined
  const result: GenerationOptions = {}
  const keys: Array<keyof GenerationOptions> = [
    "maxTokens", "temperature", "topP", "topK",
    "frequencyPenalty", "presencePenalty", "seed", "stop",
  ]
  for (const key of keys) {
    let val: unknown
    for (let i = defined.length - 1; i >= 0; i--) {
      if (defined[i][key] !== undefined) {
        val = defined[i][key]
        break
      }
    }
    if (val !== undefined) (result as Record<string, unknown>)[key] = val
  }
  return Object.values(result).some((v) => v !== undefined) ? result : undefined
}

export function mergeHttpOptions(
  ...items: ReadonlyArray<HttpOptions | undefined>
): HttpOptions | undefined {
  const defined = items.filter((i): i is HttpOptions => i !== undefined)
  if (defined.length === 0) return undefined
  const body = mergeJsonRecords(...defined.map((i) => i.body))
  const headers = mergeStringRecords(...defined.map((i) => i.headers))
  const query = mergeStringRecords(...defined.map((i) => i.query))
  if (!body && !headers && !query) return undefined
  return { body, headers, query }
}

export function mergeProviderOptions(
  ...items: ReadonlyArray<ProviderOptions | undefined>
): ProviderOptions | undefined {
  const result: Record<string, Record<string, unknown>> = {}
  for (const item of items) {
    if (!item) continue
    for (const [provider, options] of Object.entries(item)) {
      result[provider] = { ...result[provider], ...options }
    }
  }
  return Object.keys(result).length === 0 ? undefined : result
}

function mergeJsonRecords(
  ...items: ReadonlyArray<Record<string, unknown> | undefined>
): Record<string, unknown> | undefined {
  const defined = items.filter((i): i is Record<string, unknown> => i !== undefined)
  if (defined.length === 0) return undefined
  if (defined.length === 1) return defined[0]
  return Object.assign({}, ...defined)
}

function mergeStringRecords(
  ...items: ReadonlyArray<Record<string, string> | undefined>
): Record<string, string> | undefined {
  const defined = items.filter((i): i is Record<string, string> => i !== undefined)
  if (defined.length === 0) return undefined
  if (defined.length === 1) return defined[0]
  return Object.assign({}, ...defined)
}
