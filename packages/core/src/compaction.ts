// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Context Compaction (借鉴 opencode - session/compaction.ts + session/overflow.ts).
 *
 * 当 token 累计超过预算时,裁剪早期 messages,保留 system + 最近 N tokens。
 * 同时把超长 tool output 截断到 TOOL_OUTPUT_MAX_CHARS。
 */

import type { Message } from "@max/llm"
import type { ChatMessage } from "@max/providers"

// 借鉴 opencode - PRUNE_MINIMUM / PRUNE_PROTECT / TOOL_OUTPUT_MAX_CHARS / DEFAULT_TAIL_TURNS
export const PRUNE_MINIMUM = 20_000
export const PRUNE_PROTECT = 40_000
export const TOOL_OUTPUT_MAX_CHARS = 2_000
export const DEFAULT_TAIL_TURNS = 2
export const MIN_PRESERVE_RECENT_TOKENS = 2_000
export const MAX_PRESERVE_RECENT_TOKENS = 8_000

export interface CompactionConfig {
  contextWindow: number
  reservedOutput: number
  preserveRecentTokens?: number
  maxToolOutputChars?: number
  /**
   * Hidden reminders appended as a trailing system message after compaction
   * runs (minimax c460f08 borrowing). When compaction summarizes history
   * that carried per-run identity (session id, …), a stateless consumer
   * passes the identity reminder here so the model keeps it; the reminder
   * text must be findable by `scanAfterLastCompactionBoundary` (reminder.ts)
   * so the next check counts it and does not inject a second copy.
   */
  appendHiddenReminders?: string[]
}

/** Stable marker carried by every compaction-summary message. */
export const COMPACTION_SUMMARY_MARKER = "[compaction-summary]"

/**
 * True when a message is a compaction-summary boundary (the head message
 * compactMessages inserts). Reminder injection scans history AFTER the last
 * such boundary, so content summarized away before it is treated as absent.
 */
export function isCompactionBoundary(m: { role: string; content: unknown }): boolean {
  if (m.role !== "system") return false
  return flattenContent(m.content).includes(COMPACTION_SUMMARY_MARKER)
}

/** Best-effort text extraction: string content, or {text} parts arrays. */
function flattenContent(content: unknown): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  let out = ""
  for (const part of content) {
    if (part && typeof part === "object" && "text" in part) {
      out += String((part as { text?: unknown }).text ?? "")
    } else if (typeof part === "string") {
      out += part
    }
  }
  return out
}

export interface TokenUsage {
  input: number
  output: number
  cacheRead?: number
  cacheWrite?: number
}

/** 借鉴 opencode - usable(): contextWindow - reservedOutput */
export function usableTokens(cfg: CompactionConfig): number {
  return Math.max(0, cfg.contextWindow - cfg.reservedOutput)
}

/** 借鉴 opencode - isOverflow(): total usage >= usable */
export function isOverflow(usage: TokenUsage, cfg: CompactionConfig): boolean {
  const total = usage.input + usage.output + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0)
  return total >= usableTokens(cfg)
}

/**
 * 借鉴 opencode - compactMessages():
 *   1. 先把每条 tool message 输出截短到 TOOL_OUTPUT_MAX_CHARS
 *   2. 从尾部往前累加,保留最近 N tokens(DEFAULT_TAIL_TURNS 起步)
 *   3. 头部插入 system 摘要,告诉 LLM "N 条早期消息被省略"
 */
export function compactMessages(
  messages: Message[],
  cfg: CompactionConfig,
  estimateTokens: (m: Message) => number,
): Message[] {
  const preserveRecent =
    cfg.preserveRecentTokens ??
    Math.min(
      MAX_PRESERVE_RECENT_TOKENS,
      Math.max(MIN_PRESERVE_RECENT_TOKENS, Math.floor(usableTokens(cfg) * 0.25)),
    )
  const toolCap = cfg.maxToolOutputChars ?? TOOL_OUTPUT_MAX_CHARS

  // 借鉴 opencode - 先把每条 tool message 输出截短
  const truncated = messages.map((m) => truncateToolOutput(m, toolCap))

  // 借鉴 opencode - 从尾部往前累加 token,直到达到 preserveRecent
  const tail: Message[] = []
  let tailTokens = 0
  for (let i = truncated.length - 1; i >= 0; i--) {
    const m = truncated[i]!
    const t = estimateTokens(m)
    if (tailTokens + t > preserveRecent && tail.length >= DEFAULT_TAIL_TURNS) {
      break
    }
    tail.unshift(m)
    tailTokens += t
  }

  // 借鉴 opencode - 头部用一条 system summary 替代
  if (tail.length < truncated.length) {
    const dropped = truncated.length - tail.length
    const head: Message = {
      role: "system",
      content: [
        {
          type: "text" as const,
          text:
            `${COMPACTION_SUMMARY_MARKER} ${dropped} 条早期消息已被摘要省略;` +
            `后续为最近 ${tail.length} 条对话。`,
        },
      ],
    } as unknown as Message
    const base = [head, ...tail]
    // Hidden reminders (minimax c460f08 borrowing): identity the compacted
    // history used to carry is re-appended as a trailing system message so
    // the model keeps it for the rest of the turn. The next injection check
    // scans past the boundary, finds this message, and does not re-inject.
    const hidden = cfg.appendHiddenReminders ?? []
    if (hidden.length === 0) return base
    const reminder: Message = {
      role: "system",
      content: [{ type: "text" as const, text: hidden.join("\n") }],
    } as unknown as Message
    return [...base, reminder]
  }
  return tail
}

/** Sum the per-message token estimates for a whole request. */
export function estimateMessagesTokens(
  messages: readonly Message[],
  estimateTokens: (m: Message) => number,
): number {
  let total = 0
  for (const m of messages) total += estimateTokens(m)
  return total
}

/**
 * Forced compaction for context-overflow recovery (minimax 5b4e0a4
 * borrowing): the provider just rejected this request as too large, and the
 * local estimate had admitted it — so compact to a FRACTION of the rejected
 * request (default: half), regardless of the configured preserve budget.
 * Pure: returns the replacement messages; persistence is the caller's job.
 */
export function forceCompactToFractionOfRequest(
  messages: readonly Message[],
  cfg: CompactionConfig,
  estimateTokens: (m: Message) => number,
  fraction = 0.5,
): Message[] {
  const rejectedTokens = estimateMessagesTokens(messages, estimateTokens)
  const target = Math.max(0, Math.floor(rejectedTokens * fraction))
  return compactMessages([...messages], { ...cfg, preserveRecentTokens: target }, estimateTokens)
}

function truncateToolOutput(m: Message, max: number): Message {
  if (m.role !== "tool") return m
  const text = typeof m.content === "string" ? m.content : JSON.stringify(m.content)
  if (text.length <= max) return m
  return {
    ...m,
    content: [
      {
        type: "text" as const,
        text: text.slice(0, max) + `\n\n[借鉴 opencode Compaction] 截断 ${text.length - max} 字符`,
      },
    ],
  } as unknown as Message
}

// ── Proactive per-turn summary compaction (borrowing; Mini-Agent agent.py:201-319) ──
//
// The tool loop's history is ChatMessage[] (string content; tool results
// ride as user messages with the "[Tool Result: …]" prefix the loop
// writes), so the upstream structures are adapted:
//   - "user message" boundaries are REAL user intents — the loop's
//     tool-result user messages are segment content (the analogue of the
//     upstream role=="tool" messages), otherwise nothing would ever be
//     summarized;
//   - each user→user execution segment is summarized SEPARATELY (upstream
//     _create_summary), keeping every real user intent verbatim;
//   - a failing/empty summarizer degrades that segment to its raw
//     concatenated text (upstream's failure fallback) — content is never
//     dropped because the LLM summary failed;
//   - without an injected summarizer the caller keeps the existing
//     truncation behavior (compactMessages, via a lossless message
//     conversion below).

/** Prefix the tool loop writes on tool-result user messages. */
const TOOL_RESULT_PREFIX = "[Tool Result:"

/** A user message that only carries a tool result (not a real user intent). */
export function isToolResultMessage(m: { role: string; content: string }): boolean {
  return m.role === "user" && m.content.startsWith(TOOL_RESULT_PREFIX)
}

/** Injected per-turn summarizer (upstream _create_summary). */
export type CompactionSummarizer = (request: { round: number; text: string }) => Promise<string>

/** Marker prefix for per-turn summary messages (upstream "[Assistant Execution Summary]"). */
export const TURN_SUMMARY_MARKER = "[Assistant Execution Summary]"

export interface PerTurnCompactionOutcome {
  /** The compacted history: system head + every real user message + per-turn summaries. */
  messages: ChatMessage[]
  /** user→user segments summarized by the injected summarizer. */
  summarizedTurns: number
  /** Segments whose summarizer failed or returned empty — degraded to raw text. */
  degradedTurns: number
}

/** Flat text of one user→user execution segment (upstream summary_content build). */
export function flattenExecutionSegment(messages: readonly ChatMessage[]): string {
  const lines: string[] = []
  for (const m of messages) {
    if (m.role === "assistant") {
      lines.push(`Assistant: ${m.content}`)
    } else if (isToolResultMessage(m)) {
      lines.push(`Tool returned: ${m.content}`)
    } else {
      // A real user message inside the segment (steering/follow-up
      // injection mid-segment) stays verbatim — it is an intent.
      lines.push(`User: ${m.content}`)
    }
  }
  return lines.join("\n")
}

/**
 * Per-turn summary compaction (borrowing; Mini-Agent agent.py:201-319
 * _summarize_messages). Keeps the system head and EVERY real user
 * message; each user→user execution segment (assistant + tool-result
 * lines) is replaced by one summary message. A summarizer failure or
 * empty verdict degrades that segment to its raw concatenated text
 * (upstream's failure fallback returned summary_content; here the raw
 * text is appended, marked "(degraded)", so execution evidence survives
 * even when the LLM summary call fails).
 */
export async function summarizePerTurn(
  messages: readonly ChatMessage[],
  summarizer?: CompactionSummarizer,
): Promise<PerTurnCompactionOutcome> {
  const head = messages[0]?.role === "system" ? [messages[0]] : []
  const body = head.length > 0 ? messages.slice(1) : [...messages]

  // Real user intents are the segment boundaries (see isToolResultMessage).
  const userIndices: number[] = []
  for (let i = 0; i < body.length; i++) {
    const m = body[i]!
    if (m.role === "user" && !isToolResultMessage(m)) userIndices.push(i)
  }
  // Without any real user message there is no structure to rebuild.
  if (userIndices.length === 0) {
    return { messages: [...messages], summarizedTurns: 0, degradedTurns: 0 }
  }

  const out: ChatMessage[] = [...head]
  let summarizedTurns = 0
  let degradedTurns = 0

  for (let i = 0; i < userIndices.length; i++) {
    const userIdx = userIndices[i]!
    out.push(body[userIdx]!)
    const end = i < userIndices.length - 1 ? userIndices[i + 1]! : body.length
    const segment = body.slice(userIdx + 1, end)
    if (segment.length === 0) continue

    const rawText = flattenExecutionSegment(segment)
    let summaryText = ""
    if (summarizer) {
      try {
        summaryText = await summarizer({ round: i + 1, text: rawText })
      } catch {
        // Summary failure degrades to the raw text (upstream fallback).
        summaryText = ""
      }
    }
    if (summaryText) {
      summarizedTurns++
      out.push({ role: "user", content: `${TURN_SUMMARY_MARKER}\n\n${summaryText}` })
    } else {
      if (summarizer) degradedTurns++
      out.push({ role: "user", content: `${TURN_SUMMARY_MARKER} (degraded)\n\n${rawText}` })
    }
  }

  return { messages: out, summarizedTurns, degradedTurns }
}

/** Lossless ChatMessage → @max/llm Message conversion (text-only content). */
function chatToLlmMessage(m: ChatMessage): Message {
  return {
    role: m.role === "system" ? "system" : m.role === "user" ? "user" : "assistant",
    content: [{ type: "text" as const, text: m.content }],
  } as unknown as Message
}

/** Lossless @max/llm Message → ChatMessage conversion (flattens text parts). */
function llmToChatMessage(m: Message): ChatMessage {
  return {
    role: m.role === "tool" ? "user" : m.role,
    content: flattenContent(m.content),
  } as ChatMessage
}

/**
 * Proactive compaction entry (borrowing; Mini-Agent agent.py:193-257 —
 * the _summarize_messages dispatch). With a summarizer: per-turn summary
 * compaction. Without one: the existing truncation behavior —
 * compactMessages via the lossless conversion above, so the no-summarizer
 * path stays byte-for-byte the established algorithm. Pure: returns the
 * replacement messages; the caller persists them into its live history.
 */
export async function compactProactiveHistory(
  messages: readonly ChatMessage[],
  options: {
    /** Either signal above this total triggers the compaction (loop-side check). */
    tokenLimit: number
    /** Whole-request estimator; also drives the truncation fallback per message. */
    estimateTokens: (messages: readonly ChatMessage[]) => number
    summarizer?: CompactionSummarizer
    /**
     * Force-compact mode (minimax 5b4e0a4 overflow-recovery wiring): compact
     * to this FRACTION of the rejected request's estimated tokens instead of
     * the configured preserve budget — the provider just refused the request
     * as too large, so the target must scale with what was refused, capped
     * preserve budgets notwithstanding.
     */
    forceFraction?: number
  },
): Promise<ChatMessage[]> {
  if (options.summarizer) {
    return (await summarizePerTurn(messages, options.summarizer)).messages
  }
  const asLlm = messages.map(chatToLlmMessage)
  const cfg: CompactionConfig = { contextWindow: options.tokenLimit, reservedOutput: 0 }
  if (options.forceFraction === undefined) {
    const compacted = compactMessages(
      asLlm,
      cfg,
      // Per-message estimate via the whole-request estimator.
      (m) => options.estimateTokens([llmToChatMessage(m)]),
    )
    return compacted.map(llmToChatMessage)
  }
  // Force-compact mode (overflow recovery): system prompts and REAL user
  // intents stay verbatim (upstream keeps every user message; losing the
  // task instruction to the summary would break the run), while the
  // assistant/tool-result stream is tail-truncated to the requested
  // fraction of the rejected request.
  const isKept = (m: ChatMessage) =>
    m.role === "system" || (m.role === "user" && !isToolResultMessage(m))
  const compactable = messages.filter((m) => !isKept(m))
  const target = Math.max(0, Math.floor(options.estimateTokens(messages) * options.forceFraction))
  const compactedLlm = compactMessages(
    compactable.map(chatToLlmMessage),
    { ...cfg, preserveRecentTokens: target },
    (m) => options.estimateTokens([llmToChatMessage(m)]),
  )
  // compactMessages returns [summary head] + preserved tail when (and only
  // when) it dropped messages; otherwise the list passes through unchanged.
  const hasHead = compactedLlm.length !== compactable.length
  const compacted = compactedLlm.map(llmToChatMessage)
  // Re-interleave in original order: kept messages pass through verbatim;
  // the compacted stream fills the LAST `compacted.length` non-kept slots
  // (preserving the tail's recency); earlier non-kept slots are the dropped
  // region, and the summary head is emitted at its start.
  const out: ChatMessage[] = []
  const nonKeptCount = messages.length - messages.filter(isKept).length
  const skippedSlots = Math.max(0, nonKeptCount - compacted.length)
  let compactedCursor = 0
  let headEmitted = false
  let nonKeptSeen = 0
  for (const m of messages) {
    if (isKept(m)) {
      out.push(m)
      continue
    }
    if (nonKeptSeen >= skippedSlots) {
      if (!headEmitted && hasHead) {
        out.push(compacted[0]!)
        headEmitted = true
        compactedCursor = 1
      }
      out.push(compacted[compactedCursor]!)
      compactedCursor += 1
    }
    nonKeptSeen += 1
  }
  return out
}
