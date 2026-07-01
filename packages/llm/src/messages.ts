// Message and content part types — plain TypeScript
// Derived from OpenCode packages/llm/src/schema/messages.ts

import type { ContentBlockID, JsonSchema, MessageRole, ProviderMetadata, ToolCallID } from "./types.js"
import type { CacheHint, CachePolicy, GenerationOptions, HttpOptions, ModelDef, ProviderOptions } from "./options.js"

// ── Content Parts ──

export interface SystemPart {
  readonly type: "text"
  readonly text: string
  readonly cache?: CacheHint
  readonly metadata?: Record<string, unknown>
}

export interface TextPart {
  readonly type: "text"
  readonly text: string
  readonly cache?: CacheHint
  readonly metadata?: Record<string, unknown>
  readonly providerMetadata?: ProviderMetadata
}

export interface MediaPart {
  readonly type: "media"
  readonly mediaType: string
  readonly data: string | Uint8Array
  readonly filename?: string
  readonly metadata?: Record<string, unknown>
}

export interface ToolCallPart {
  readonly type: "tool-call"
  readonly id: ToolCallID
  readonly name: string
  readonly input: unknown
  readonly providerExecuted?: boolean
  readonly metadata?: Record<string, unknown>
  readonly providerMetadata?: ProviderMetadata
}

export interface ToolResultPart {
  readonly type: "tool-result"
  readonly id: ToolCallID
  readonly name: string
  readonly result: ToolResultValue
  readonly providerExecuted?: boolean
  readonly cache?: CacheHint
  readonly metadata?: Record<string, unknown>
  readonly providerMetadata?: ProviderMetadata
}

export interface ReasoningPart {
  readonly type: "reasoning"
  readonly text: string
  readonly encrypted?: string
  readonly metadata?: Record<string, unknown>
  readonly providerMetadata?: ProviderMetadata
}

export type ContentPart = TextPart | MediaPart | ToolCallPart | ToolResultPart | ReasoningPart

// ── Tool Content ──

export interface ToolTextContent {
  readonly type: "text"
  readonly text: string
}

export interface ToolFileContent {
  readonly type: "file"
  readonly uri: string
  readonly mime: string
  readonly name?: string
}

export type ToolContent = ToolTextContent | ToolFileContent

// ── Tool Result Value ──

export type ToolResultValue =
  | { readonly type: "json"; readonly value: unknown }
  | { readonly type: "text"; readonly value: unknown }
  | { readonly type: "error"; readonly value: unknown }
  | { readonly type: "content"; readonly value: ReadonlyArray<ToolContent> }

export function isToolResultValue(value: unknown): value is ToolResultValue {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    "value" in value &&
    ((value as Record<string, unknown>).type === "text" ||
      (value as Record<string, unknown>).type === "json" ||
      (value as Record<string, unknown>).type === "error" ||
      (value as Record<string, unknown>).type === "content")
  )
}

export function makeToolResultValue(value: unknown, type: ToolResultValue["type"] = "json"): ToolResultValue {
  if (isToolResultValue(value)) return value
  if (type === "content") return { type, value: Array.isArray(value) ? (value as ToolContent[]) : [] }
  return { type, value }
}

// ── Tool Output ──

export interface ToolOutput {
  readonly structured: unknown
  readonly content: ReadonlyArray<ToolContent>
}

export function makeToolOutput(structured: unknown, content: ReadonlyArray<ToolContent> = []): ToolOutput {
  return { structured, content }
}

export function toolOutputFromResult(result: ToolResultValue): ToolOutput | undefined {
  switch (result.type) {
    case "json":
      return { structured: result.value, content: [] }
    case "text":
      return { structured: {}, content: [{ type: "text", text: toolResultText(result.value) }] }
    case "content":
      return { structured: {}, content: result.value }
    case "error":
      return undefined
  }
}

export function toolOutputToResult(output: ToolOutput): ToolResultValue {
  if (output.content.length === 0) return { type: "json", value: output.structured }
  if (output.content.length === 1 && output.content[0]?.type === "text")
    return { type: "text", value: output.content[0].text }
  return { type: "content", value: output.content }
}

function toolResultText(value: unknown): string {
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

// ── Messages ──

export interface Message {
  readonly id?: string
  readonly role: MessageRole
  readonly content: ReadonlyArray<ContentPart>
  readonly metadata?: Record<string, unknown>
  readonly native?: Record<string, unknown>
}

export function makeTextPart(text: string): TextPart {
  return { type: "text", text }
}

export function makeToolCallPart(input: Omit<ToolCallPart, "type">): ToolCallPart {
  return { type: "tool-call", ...input }
}

export function makeToolResultPart(
  input: Omit<ToolResultPart, "type" | "result"> & {
    readonly result: unknown
    readonly resultType?: ToolResultValue["type"]
  },
): ToolResultPart {
  return {
    type: "tool-result",
    id: input.id,
    name: input.name,
    result: makeToolResultValue(input.result, input.resultType),
    providerExecuted: input.providerExecuted,
    cache: input.cache,
    metadata: input.metadata,
    providerMetadata: input.providerMetadata,
  }
}

export function toContentParts(input: string | ContentPart | ReadonlyArray<ContentPart>): ContentPart[] {
  if (typeof input === "string") return [makeTextPart(input)]
  if (Array.isArray(input)) return (input as readonly ContentPart[]).slice() as ContentPart[]
  return [input as ContentPart]
}

export function makeMessage(
  role: MessageRole,
  content: string | ContentPart | ReadonlyArray<ContentPart>,
  extra?: Partial<Omit<Message, "role" | "content">>,
): Message {
  return { role, content: toContentParts(content), ...extra }
}

export function userMessage(content: string | ContentPart | ReadonlyArray<ContentPart>): Message {
  return makeMessage("user", content)
}

export function assistantMessage(content: string | ContentPart | ReadonlyArray<ContentPart>): Message {
  return makeMessage("assistant", content)
}

export function systemMessage(content: string | SystemPart | ReadonlyArray<SystemPart>): Message {
  if (typeof content === "string") return makeMessage("system", [{ type: "text", text: content }])
  if (Array.isArray(content)) return makeMessage("system", content as unknown as ContentPart[])
  return makeMessage("system", [content] as unknown as ContentPart[])
}

export function toolResultMessage(result: ToolResultPart | Parameters<typeof makeToolResultPart>[0]): Message {
  const part = "type" in result && result.type === "tool-result" ? result : makeToolResultPart(result)
  return makeMessage("tool", [part])
}

// ── Tool Definition ──

export interface ToolDefinition {
  readonly name: string
  readonly description: string
  readonly inputSchema: JsonSchema
  readonly outputSchema?: JsonSchema
  readonly cache?: CacheHint
  readonly metadata?: Record<string, unknown>
  readonly native?: Record<string, unknown>
}

export function makeToolDefinition(input: ToolDefinition): ToolDefinition {
  return input
}

// ── Tool Choice ──

export type ToolChoiceMode = "auto" | "none" | "required"

export interface ToolChoice {
  readonly type: "auto" | "none" | "required" | "tool"
  readonly name?: string
}

export function makeToolChoice(input: ToolChoice | ToolChoiceMode | string): ToolChoice {
  if (typeof input === "object") return input
  if (input === "auto" || input === "none" || input === "required") return { type: input }
  return { type: "tool", name: input }
}

// ── Response Format ──

export type ResponseFormat =
  | { readonly type: "text" }
  | { readonly type: "json"; readonly schema: JsonSchema }
  | { readonly type: "tool"; readonly tool: ToolDefinition }

// ── LLM Request ──

export interface LLMRequest {
  readonly id?: string
  readonly model: ModelDef
  readonly system: ReadonlyArray<SystemPart>
  readonly messages: ReadonlyArray<Message>
  readonly tools: ReadonlyArray<ToolDefinition>
  readonly toolChoice?: ToolChoice
  readonly generation?: GenerationOptions
  readonly providerOptions?: ProviderOptions
  readonly http?: HttpOptions
  readonly responseFormat?: ResponseFormat
  readonly cache?: CachePolicy
  readonly metadata?: Record<string, unknown>
}

export function makeLLMRequest(input: LLMRequest): LLMRequest {
  return input
}

export function updateLLMRequest(request: LLMRequest, patch: Partial<LLMRequest>): LLMRequest {
  if (Object.keys(patch).length === 0) return request
  return { ...request, ...patch }
}
