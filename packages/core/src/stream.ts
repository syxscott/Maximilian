/**
 * Stream chunk types — 借鉴 deepseek-harness llm/src/types.ts.
 *
 * Provides the canonical ContentBlock / StreamChunk / TokenUsage / FinishReason
 * type vocabulary used by the BlockAssembler and provider adapters.
 *
 * Principle: these are pure data types — no runtime logic, no side effects.
 */

// ── LlmFailure ───────────────────────────────────────────────────────────

/**
 * Structured provider or transport failure facts.
 * Carried by LlmError and finish-reason so callers can inspect structured data.
 */
export interface LlmFailure {
  readonly message: string
  readonly status?: number
  readonly providerRetryAfterMs?: number
  readonly requestId?: string
}

// ── Content Blocks ───────────────────────────────────────────────────────

/** Text content block. */
export interface TextBlock {
  readonly type: "text"
  readonly text: string
}

/** Reasoning / thinking content block (distinct from visible text). */
export interface ReasoningBlock {
  readonly type: "reasoning"
  readonly text: string
}

/** Image content block. */
export interface ImageBlock {
  readonly type: "image"
  readonly mediaType: string
  readonly data: string
}

/** A tool invocation requested by the model. */
export interface ToolCallBlock {
  readonly type: "tool-call"
  readonly id: string
  readonly name: string
  /** Raw JSON string as produced by the model. */
  readonly arguments: string
}

/** The result of a tool invocation, sent back to the model. */
export interface ToolResultBlock {
  readonly type: "tool-result"
  readonly toolCallId: string
  readonly content: ContentBlock[]
  readonly isError?: boolean
}

/** Union of all known content block variants. */
export type ContentBlock = TextBlock | ReasoningBlock | ImageBlock | ToolCallBlock | ToolResultBlock

// ── Token Usage ─────────────────────────────────────────────────────────

/**
 * Token accounting for one model call.
 * All fields are optional because not every provider reports every metric.
 *
 * Note: counts are DISJOINT for cache — `inputTokens` is uncached input only;
 * cached input is reported separately as `cacheReadTokens` / `cacheWriteTokens`.
 */
export interface TokenUsage {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens?: number
  readonly cacheWriteTokens?: number
  readonly reasoningTokens?: number
}

// ── Finish Reason ────────────────────────────────────────────────────────

/** Normal stop — model ended naturally. */
export interface FinishReasonStop {
  readonly kind: "stop"
}

/** Model requested tool calls. */
export interface FinishReasonToolCalls {
  readonly kind: "tool-calls"
}

/** Output truncated by max-tokens. */
export interface FinishReasonMaxTokens {
  readonly kind: "max-tokens"
}

/** Generation aborted by caller. */
export interface FinishReasonAborted {
  readonly kind: "aborted"
  readonly failure: LlmFailure
}

/** Generation terminated by an error. */
export interface FinishReasonError {
  readonly kind: "error"
  readonly failure: LlmFailure
}

/** Any known finish reason. */
export type FinishReason =
  | FinishReasonStop
  | FinishReasonToolCalls
  | FinishReasonMaxTokens
  | FinishReasonAborted
  | FinishReasonError

// ── Stream Chunks ────────────────────────────────────────────────────────

/**
 * Marks the start of a new content block.
 * `index` is the block's position in the stream; `blockType` is the block variant tag.
 */
export interface BlockStartChunk {
  readonly type: "block-start"
  readonly index: number
  readonly blockType: ContentBlock["type"]
}

/** Incremental text delta for an open block. */
export interface TextDeltaChunk {
  readonly type: "text-delta"
  readonly index: number
  readonly text: string
}

/** Incremental reasoning/thinking delta for an open block. */
export interface ReasoningDeltaChunk {
  readonly type: "reasoning-delta"
  readonly index: number
  readonly text: string
}

/**
 * Incremental tool-call delta.
 * Deltas for the same `index` concatenate — `id`/`name` appear only on the first delta.
 */
export interface ToolCallDeltaChunk {
  readonly type: "tool-call-delta"
  readonly index: number
  /** Present only on the first delta for this call; absent on subsequent deltas. */
  readonly id?: string
  readonly name?: string
  readonly argumentsDelta: string
}

/** Marks a block as complete and frozen. */
export interface BlockEndChunk {
  readonly type: "block-end"
  readonly index: number
  readonly block: ContentBlock
}

/** Token usage report (arrives before or with the finish chunk). */
export interface UsageChunk {
  readonly type: "usage"
  readonly usage: TokenUsage
}

/**
 * Terminal finish event.
 * `reason` is always present; `replayState` is adapter-private for replay fidelity.
 */
export interface FinishChunk {
  readonly type: "finish"
  readonly reason: FinishReason
  readonly replayState?: unknown
  readonly usage?: TokenUsage
}

/** Any known stream chunk variant. */
export type StreamChunk =
  | BlockStartChunk
  | TextDeltaChunk
  | ReasoningDeltaChunk
  | ToolCallDeltaChunk
  | BlockEndChunk
  | UsageChunk
  | FinishChunk
