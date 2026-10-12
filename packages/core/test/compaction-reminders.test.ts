// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT

/**
 * Compaction × per-turn reminder cooperation (minimax 8e93b19/c460f08
 * borrowing): the compaction boundary marker, hidden post-compaction
 * reminders, and forced compaction for context-overflow recovery.
 */
import { describe, expect, it } from "vitest"
import type { Message } from "@max/llm"
import {
  compactMessages,
  estimateMessagesTokens,
  forceCompactToFractionOfRequest,
  isCompactionBoundary,
  COMPACTION_SUMMARY_MARKER,
  type CompactionConfig,
} from "../src/compaction.js"
import {
  findLastCompactionBoundary,
  shouldInjectSessionIdentity,
  sessionIdentityReminder,
} from "../src/reminder.js"

const mk = (role: string, content: string): Message => ({ role, content }) as unknown as Message

const cfg: CompactionConfig = { contextWindow: 100_000, reservedOutput: 4_000 }

/** 4 short messages compact into [summary head, 2-message tail]. */
const compactFour = (cfgOverrides?: Partial<CompactionConfig>): Message[] =>
  compactMessages(
    [mk("user", "q1"), mk("assistant", "a1"), mk("user", "q2"), mk("assistant", "a2")],
    { ...cfg, preserveRecentTokens: 10, ...cfgOverrides },
    () => 10,
  )

describe("compaction boundary marker", () => {
  it("stamps every summary head with the stable marker", () => {
    const out = compactFour()
    expect(out.length).toBe(3) // head + 2-message tail
    expect(isCompactionBoundary(out[0]!)).toBe(true)
    expect(JSON.stringify(out[0]!.content)).toContain(COMPACTION_SUMMARY_MARKER)
  })

  it("does not mistake ordinary messages for boundaries", () => {
    expect(isCompactionBoundary(mk("user", COMPACTION_SUMMARY_MARKER))).toBe(false)
    expect(isCompactionBoundary(mk("system", "regular system prompt"))).toBe(false)
  })

  it("findLastCompactionBoundary returns the LAST boundary index", () => {
    const first = compactFour()
    expect(findLastCompactionBoundary(first)).toBe(0)
    const second = compactFour()
    const twice = [...first, mk("user", "q2"), ...second]
    // The second summary head sits after `first` and the interleaved message.
    expect(findLastCompactionBoundary(twice)).toBe(first.length + 1)
  })

  it("returns -1 for histories without a boundary", () => {
    expect(findLastCompactionBoundary([mk("user", "hi")])).toBe(-1)
    expect(findLastCompactionBoundary([])).toBe(-1)
  })
})

describe("post-compaction hidden reminders (identity restore)", () => {
  it("appends hidden reminders as a trailing system message after compaction", () => {
    const out = compactFour({ appendHiddenReminders: [sessionIdentityReminder("s-1")] })
    expect(out.length).toBe(4)
    const last = out[out.length - 1]!
    expect(last.role).toBe("system")
    expect(JSON.stringify(last.content)).toContain("YOUR SESSION ID: s-1")
    // The reminder is NOT itself a boundary.
    expect(isCompactionBoundary(last)).toBe(false)
  })

  it("appends nothing when no hidden reminders are configured", () => {
    const out = compactFour()
    expect(out.filter((m) => m.role === "system" && !isCompactionBoundary(m))).toEqual([])
  })

  it("closes the loop: the hidden reminder satisfies the next injection check", () => {
    const sessionId = "sess-42"
    const pre = [
      mk("user", `please remember my session ${sessionId}`),
      mk("assistant", "ok"),
      mk("user", "go on"),
      mk("assistant", "doing it"),
    ]
    // Before compaction the visible history carries the id → no injection.
    expect(shouldInjectSessionIdentity(pre, sessionId)).toBe(false)
    // Compaction summarizes that history away, appending the hidden identity
    // reminder (the stateless post-compaction hook).
    const post = compactMessages(
      pre,
      {
        ...cfg,
        preserveRecentTokens: 10,
        appendHiddenReminders: [sessionIdentityReminder(sessionId)],
      },
      () => 10,
    )
    // The next check counts the reminder: no duplicate injection.
    expect(shouldInjectSessionIdentity(post, sessionId)).toBe(false)
    // Whereas a compaction WITHOUT the reminder leaves the id absent → the
    // check requests an injection.
    const postWithout = compactMessages(pre, { ...cfg, preserveRecentTokens: 10 }, () => 10)
    expect(shouldInjectSessionIdentity(postWithout, sessionId)).toBe(true)
  })
})

describe("forced compaction for overflow recovery", () => {
  const estimate = (m: Message): number => {
    const content = m.content as unknown
    return Math.ceil((typeof content === "string" ? content : "").length / 4)
  }
  const bigMessage = (role: string): Message => mk(role, "x".repeat(400)) // 100 tokens

  it("estimateMessagesTokens sums per-message estimates", () => {
    const messages = [mk("user", "x".repeat(40)), mk("assistant", "y".repeat(8))]
    expect(estimateMessagesTokens(messages, estimate)).toBe(12)
  })

  it("targets at most half of the rejected request's tokens", () => {
    const messages = [
      bigMessage("user"),
      bigMessage("assistant"),
      bigMessage("user"),
      bigMessage("assistant"),
    ]
    const rejectedTokens = estimateMessagesTokens(messages, estimate)
    expect(rejectedTokens).toBe(400)
    const out = forceCompactToFractionOfRequest(messages, cfg, estimate)
    const kept = isCompactionBoundary(out[0]!) ? out.slice(1) : out
    // Half of 400 = 200-token budget for the preserved tail (bounded below
    // only by the DEFAULT_TAIL_TURNS floor).
    expect(estimateMessagesTokens(kept, estimate)).toBeLessThanOrEqual(220)
    expect(kept.length).toBeLessThan(messages.length)
  })

  it("always changes something the model can see (summary head present)", () => {
    const messages = Array.from({ length: 12 }, (_, i) => bigMessage(i % 2 ? "assistant" : "user"))
    const out = forceCompactToFractionOfRequest(messages, cfg, estimate)
    expect(out.length).toBeLessThan(messages.length)
    expect(isCompactionBoundary(out[0]!)).toBe(true)
  })
})
