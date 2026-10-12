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
