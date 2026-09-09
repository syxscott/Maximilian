/**
 * Message types — 借鉴 deepseek-harness llm/src/message.ts.
 *
 * Provides attributed message construction with source tracking (user/model/tool/plugin).
 * All messages are immutable and frozen after creation.
 */

import type { ContentBlock } from "./stream.js"

// ── Message Source ────────────────────────────────────────────────────────

/** Message originates from the user. */
export interface MessageSourceUser {
  readonly kind: "user"
}

/** Message originates from a model response. */
export interface MessageSourceModel {
  readonly kind: "model"
  readonly provider: string
  readonly model: string
}

/** Message is a tool result. */
export interface MessageSourceTool {
  readonly kind: "tool"
  readonly callId: string
}

/** Message is from a plugin. */
export interface MessageSourcePlugin {
  readonly kind: "plugin"
  readonly plugin: string
}

export type MessageSource =
  MessageSourceUser | MessageSourceModel | MessageSourceTool | MessageSourcePlugin

// ── Message ──────────────────────────────────────────────────────────────

/**
 * An immutable message with source attribution.
 *
 * All fields are readonly — callers must not mutate message content after creation.
 * Use the factory functions (createMessage, createUserMessage, etc.) to build instances.
 */
export interface Message {
  readonly id: string
  readonly role: "system" | "user" | "assistant"
  readonly content: ContentBlock[]
  readonly source: MessageSource
}

// ── ID Generation ─────────────────────────────────────────────────────────

function nextId(): string {
  return crypto.randomUUID()
}

// ── Specialized Message Types (借鉴 deepseek-harness) ───────────────────

/** User-role message specialization. */
export interface UserMessage extends Message {
  readonly role: "user"
  readonly source: MessageSourceUser
}

/** Model-produced assistant specialization with provenance. */
export interface AssistantMessage extends Message {
  readonly role: "assistant"
  readonly source: MessageSourceModel
}

/** Tool-result specialization with call correlation. */
export interface ToolResultMessage extends Message {
  readonly role: "user"
  readonly source: MessageSourceTool
}

// ── Factory Functions ─────────────────────────────────────────────────────

interface CreateMessageInput {
  readonly role: Message["role"]
  readonly content: ContentBlock[]
  readonly source: MessageSource
  readonly id?: string
}

/** Deep-freeze a value recursively. */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value
  if (Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const key of Object.keys(value as object)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return value
}

/**
 * Create a fully-structured Message with a fresh UUID-based ID.
 * The returned message is deep-frozen.
 */
export function createMessage(input: CreateMessageInput): Message {
  switch (input.role) {
    case "user":
      if (input.source.kind !== "user" && input.source.kind !== "tool") {
        throw new Error(
          `createMessage: user role requires source.kind "user" or "tool", got "${input.source.kind}"`,
        )
      }
      break
    case "assistant":
      if (input.source.kind !== "model") {
        throw new Error(
          `createMessage: assistant role requires source.kind "model", got "${input.source.kind}"`,
        )
      }
      break
    case "system":
      if (input.source.kind !== "user" && input.source.kind !== "plugin") {
        throw new Error(
          `createMessage: system role requires source.kind "user" or "plugin", got "${input.source.kind}"`,
        )
      }
      break
  }
  return deepFreeze({
    id: input.id ?? nextId(),
    role: input.role,
    content: deepFreeze([...input.content]),
    source: deepFreeze({ ...input.source }),
  }) as Message
}

/**
 * Create a user message.
 * The returned message is deep-frozen.
 */
export function createUserMessage(input: {
  readonly content: ContentBlock[]
  readonly id?: string
}): UserMessage {
  return createMessage({
    role: "user",
    content: input.content,
    source: { kind: "user" },
    id: input.id,
  }) as UserMessage
}

/**
 * Create an assistant message with model attribution.
 * The returned message is deep-frozen.
 */
export function createAssistantMessage(input: {
  readonly content: ContentBlock[]
  readonly provider: string
  readonly model: string
  readonly id?: string
}): AssistantMessage {
  return createMessage({
    role: "assistant",
    content: input.content,
    source: { kind: "model", provider: input.provider, model: input.model },
    id: input.id,
  }) as AssistantMessage
}

/**
 * Create a tool-result message.
 * The returned message is deep-frozen.
 */
export function createToolResultMessage(input: {
  readonly content: ContentBlock[]
  readonly callId: string
  readonly id?: string
}): ToolResultMessage {
  return createMessage({
    role: "user",
    content: input.content,
    source: { kind: "tool", callId: input.callId },
    id: input.id,
  }) as ToolResultMessage
}

// ── Immutability Helpers ─────────────────────────────────────────────────

/**
 * Deep-freeze a message to prevent accidental mutation.
 * Returns the same reference (in-place freeze).
 */
export function freezeMessage<T extends Message>(message: T): T {
  return deepFreeze(message)
}

// ── Chunk Predicates ─────────────────────────────────────────────────────

// Import StreamChunk type lazily to avoid circular reference
import type { StreamChunk } from "./stream.js"

/**
 * Whether a stream chunk carries visible model output.
 * Empty deltas (heartbeats, empty frames) do not count as a first token.
 */
export function isTokenDelta(chunk: StreamChunk): boolean {
  switch (chunk.type) {
    case "text-delta":
      return chunk.text !== ""
    case "reasoning-delta":
      return chunk.text !== ""
    case "tool-call-delta":
      return chunk.argumentsDelta !== "" || chunk.name !== undefined
    default:
      return false
  }
}
