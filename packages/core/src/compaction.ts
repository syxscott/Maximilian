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

import type { ChatMessage } from "@max/llm"

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
  const total =
    usage.input +
    usage.output +
    (usage.cacheRead ?? 0) +
    (usage.cacheWrite ?? 0)
  return total >= usableTokens(cfg)
}

/**
 * 借鉴 opencode - compactMessages():
 *   1. 先把每条 tool message 输出截短到 TOOL_OUTPUT_MAX_CHARS
 *   2. 从尾部往前累加,保留最近 N tokens(DEFAULT_TAIL_TURNS 起步)
 *   3. 头部插入 system 摘要,告诉 LLM "N 条早期消息被省略"
 */
export function compactMessages(
  messages: ChatMessage[],
  cfg: CompactionConfig,
  estimateTokens: (m: ChatMessage) => number,
): ChatMessage[] {
  const preserveRecent =
    cfg.preserveRecentTokens ??
    Math.min(
      MAX_PRESERVE_RECENT_TOKENS,
      Math.max(
        MIN_PRESERVE_RECENT_TOKENS,
        Math.floor(usableTokens(cfg) * 0.25),
      ),
    )
  const toolCap = cfg.maxToolOutputChars ?? TOOL_OUTPUT_MAX_CHARS

  // 借鉴 opencode - 先把每条 tool message 输出截短
  const truncated = messages.map((m) => truncateToolOutput(m, toolCap))

  // 借鉴 opencode - 从尾部往前累加 token,直到达到 preserveRecent
  const tail: ChatMessage[] = []
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
    const head: ChatMessage = {
      role: "system",
      content:
        `[借鉴 opencode Compaction] ${dropped} 条早期消息已被摘要省略;` +
        `后续为最近 ${tail.length} 条对话。`,
    } as ChatMessage
    return [head, ...tail]
  }
  return tail
}

function truncateToolOutput(m: ChatMessage, max: number): ChatMessage {
  if (m.role !== "tool") return m
  const text = typeof m.content === "string" ? m.content : JSON.stringify(m.content)
  if (text.length <= max) return m
  return {
    ...m,
    content:
      text.slice(0, max) +
      `\n\n[借鉴 opencode Compaction] 截断 ${text.length - max} 字符`,
  }
}