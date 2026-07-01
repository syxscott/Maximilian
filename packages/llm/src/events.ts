// LLM event types — plain TypeScript
// Derived from OpenCode packages/llm/src/schema/events.ts

import type { ContentBlockID, FinishReason, ProtocolID, ProviderMetadata, RouteID, ToolCallID } from "./types.js"
import type { ModelDef } from "./options.js"
import type { ToolOutput, ToolResultValue } from "./messages.js"

// ── Usage ──

export interface Usage {
  readonly inputTokens?: number
  readonly outputTokens?: number
  readonly nonCachedInputTokens?: number
  readonly cacheReadInputTokens?: number
  readonly cacheWriteInputTokens?: number
  readonly reasoningTokens?: number
  readonly totalTokens?: number
  readonly providerMetadata?: ProviderMetadata
}

export function visibleOutputTokens(usage: Usage): number {
  return Math.max(0, (usage.outputTokens ?? 0) - (usage.reasoningTokens ?? 0))
}

// ── Event Types ──

export interface StepStart {
  readonly type: "step-start"
  readonly index: number
}

export interface TextStart {
  readonly type: "text-start"
  readonly id: ContentBlockID
  readonly providerMetadata?: ProviderMetadata
}

export interface TextDelta {
  readonly type: "text-delta"
  readonly id: ContentBlockID
  readonly text: string
  readonly providerMetadata?: ProviderMetadata
}

export interface TextEnd {
  readonly type: "text-end"
  readonly id: ContentBlockID
  readonly providerMetadata?: ProviderMetadata
}

export interface ReasoningStart {
  readonly type: "reasoning-start"
  readonly id: ContentBlockID
  readonly providerMetadata?: ProviderMetadata
}

export interface ReasoningDelta {
  readonly type: "reasoning-delta"
  readonly id: ContentBlockID
  readonly text: string
  readonly providerMetadata?: ProviderMetadata
}

export interface ReasoningEnd {
  readonly type: "reasoning-end"
  readonly id: ContentBlockID
  readonly providerMetadata?: ProviderMetadata
}

export interface ToolInputStart {
  readonly type: "tool-input-start"
  readonly id: ToolCallID
  readonly name: string
  readonly providerMetadata?: ProviderMetadata
}

export interface ToolInputDelta {
  readonly type: "tool-input-delta"
  readonly id: ToolCallID
  readonly name: string
  readonly text: string
}

export interface ToolInputEnd {
  readonly type: "tool-input-end"
  readonly id: ToolCallID
  readonly name: string
  readonly providerMetadata?: ProviderMetadata
}

export interface ToolCall {
  readonly type: "tool-call"
  readonly id: ToolCallID
  readonly name: string
  readonly input: unknown
  readonly providerExecuted?: boolean
  readonly providerMetadata?: ProviderMetadata
}

export interface ToolResult {
  readonly type: "tool-result"
  readonly id: ToolCallID
  readonly name: string
  readonly result: ToolResultValue
  readonly output?: ToolOutput
  readonly providerExecuted?: boolean
  readonly providerMetadata?: ProviderMetadata
}

export interface ToolError {
  readonly type: "tool-error"
  readonly id: ToolCallID
  readonly name: string
  readonly message: string
  readonly error?: unknown
  readonly providerMetadata?: ProviderMetadata
}

export interface StepFinish {
  readonly type: "step-finish"
  readonly index: number
  readonly reason: FinishReason
  readonly usage?: Usage
  readonly providerMetadata?: ProviderMetadata
}

export interface Finish {
  readonly type: "finish"
  readonly reason: FinishReason
  readonly usage?: Usage
  readonly providerMetadata?: ProviderMetadata
}

export interface ProviderErrorEvent {
  readonly type: "provider-error"
  readonly message: string
  readonly classification?: "context-overflow"
  readonly retryable?: boolean
  readonly providerMetadata?: ProviderMetadata
}

export type LLMEvent =
  | StepStart
  | TextStart
  | TextDelta
  | TextEnd
  | ReasoningStart
  | ReasoningDelta
  | ReasoningEnd
  | ToolInputStart
  | ToolInputDelta
  | ToolInputEnd
  | ToolCall
  | ToolResult
  | ToolError
  | StepFinish
  | Finish
  | ProviderErrorEvent

// ── Event Factories ──

export const LLMEvent = {
  stepStart: (index: number): StepStart => ({ type: "step-start", index }),
  textStart: (id: ContentBlockID): TextStart => ({ type: "text-start", id }),
  textDelta: (id: ContentBlockID, text: string): TextDelta => ({ type: "text-delta", id, text }),
  textEnd: (id: ContentBlockID): TextEnd => ({ type: "text-end", id }),
  reasoningStart: (id: ContentBlockID): ReasoningStart => ({ type: "reasoning-start", id }),
  reasoningDelta: (id: ContentBlockID, text: string): ReasoningDelta => ({ type: "reasoning-delta", id, text }),
  reasoningEnd: (id: ContentBlockID): ReasoningEnd => ({ type: "reasoning-end", id }),
  toolInputStart: (id: ToolCallID, name: string): ToolInputStart => ({ type: "tool-input-start", id, name }),
  toolInputDelta: (id: ToolCallID, name: string, text: string): ToolInputDelta => ({
    type: "tool-input-delta", id, name, text,
  }),
  toolInputEnd: (id: ToolCallID, name: string): ToolInputEnd => ({ type: "tool-input-end", id, name }),
  toolCall: (id: ToolCallID, name: string, input: unknown): ToolCall => ({ type: "tool-call", id, name, input }),
  toolResult: (id: ToolCallID, name: string, result: ToolResultValue): ToolResult => ({
    type: "tool-result", id, name, result,
  }),
  toolError: (id: ToolCallID, name: string, message: string): ToolError => ({
    type: "tool-error", id, name, message,
  }),
  stepFinish: (index: number, reason: FinishReason, usage?: Usage): StepFinish => ({
    type: "step-finish", index, reason, usage,
  }),
  finish: (reason: FinishReason, usage?: Usage): Finish => ({ type: "finish", reason, usage }),
  providerError: (message: string, retryable?: boolean): ProviderErrorEvent => ({
    type: "provider-error", message, retryable,
  }),
} as const

// ── Event Guards ──

export const isStepStart = (e: LLMEvent): e is StepStart => e.type === "step-start"
export const isTextStart = (e: LLMEvent): e is TextStart => e.type === "text-start"
export const isTextDelta = (e: LLMEvent): e is TextDelta => e.type === "text-delta"
export const isTextEnd = (e: LLMEvent): e is TextEnd => e.type === "text-end"
export const isReasoningStart = (e: LLMEvent): e is ReasoningStart => e.type === "reasoning-start"
export const isReasoningDelta = (e: LLMEvent): e is ReasoningDelta => e.type === "reasoning-delta"
export const isReasoningEnd = (e: LLMEvent): e is ReasoningEnd => e.type === "reasoning-end"
export const isToolInputStart = (e: LLMEvent): e is ToolInputStart => e.type === "tool-input-start"
export const isToolInputDelta = (e: LLMEvent): e is ToolInputDelta => e.type === "tool-input-delta"
export const isToolInputEnd = (e: LLMEvent): e is ToolInputEnd => e.type === "tool-input-end"
export const isToolCall = (e: LLMEvent): e is ToolCall => e.type === "tool-call"
export const isToolResult = (e: LLMEvent): e is ToolResult => e.type === "tool-result"
export const isToolError = (e: LLMEvent): e is ToolError => e.type === "tool-error"
export const isStepFinish = (e: LLMEvent): e is StepFinish => e.type === "step-finish"
export const isFinish = (e: LLMEvent): e is Finish => e.type === "finish"
export const isProviderError = (e: LLMEvent): e is ProviderErrorEvent => e.type === "provider-error"

// ── Prepared Request ──

export interface PreparedRequest {
  readonly id: string
  readonly route: RouteID
  readonly protocol: ProtocolID
  readonly model: ModelDef
  readonly body: unknown
  readonly metadata?: Record<string, unknown>
}

// ── LLM Response ──

export interface LLMResponse {
  readonly events: ReadonlyArray<LLMEvent>
  readonly usage?: Usage
}

export function responseText(response: LLMResponse): string {
  return response.events
    .filter((e): e is TextDelta => e.type === "text-delta")
    .map((e) => e.text)
    .join("")
}

export function responseReasoning(response: LLMResponse): string {
  return response.events
    .filter((e): e is ReasoningDelta => e.type === "reasoning-delta")
    .map((e) => e.text)
    .join("")
}

export function responseToolCalls(response: LLMResponse): ToolCall[] {
  return response.events.filter((e): e is ToolCall => e.type === "tool-call")
}

export function responseUsage(response: LLMResponse): Usage | undefined {
  return response.usage ?? response.events.find((e): e is StepFinish => e.type === "step-finish")?.usage
}
