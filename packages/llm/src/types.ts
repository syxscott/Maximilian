// Core type definitions — plain TypeScript, no Effect-TS
// Derived from OpenCode packages/llm/src/schema/ids.ts

/** Stable string identifier for a protocol implementation. */
export type ProtocolID = string

/** Stable string identifier for the runnable route. */
export type RouteID = string

/** Branded string type for model identifiers. */
export type ModelID = string & { readonly __brand: "LLM.ModelID" }
export function ModelID(id: string): ModelID {
  return id as ModelID
}

/** Branded string type for provider identifiers. */
export type ProviderID = string & { readonly __brand: "LLM.ProviderID" }
export function ProviderID(id: string): ProviderID {
  return id as ProviderID
}

export type ResponseID = string
export type ContentBlockID = string
export type ToolCallID = string

export const REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number]

export type TextVerbosity = "low" | "medium" | "high"

export type MessageRole = "system" | "user" | "assistant" | "tool"

export type FinishReason = "stop" | "length" | "tool-calls" | "content-filter" | "error" | "unknown"

export type JsonSchema = Record<string, unknown>

export type ProviderMetadata = Record<string, Record<string, unknown>>
