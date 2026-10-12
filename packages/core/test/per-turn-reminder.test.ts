// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT

/**
 * Per-turn reminder injection mechanics (minimax 8e93b19 blocks.ts
 * sessionIdInContext/historyCarriesSessionId + agency-swarm 5e26b7cc
 * single-owner borrowing): boundary-stopped forward scan, identity gate, and
 * exactly-one-injector ownership.
 */
import { describe, expect, it } from "vitest"
import {
  SESSION_IDENTITY_REMINDER_PREFIX,
  sessionIdentityReminder,
  findLastCompactionBoundary,
  historyAfterLastCompactionCarries,
  shouldInjectSessionIdentity,
  SingleOwnerInjectionGate,
} from "../src/reminder.js"
import { COMPACTION_SUMMARY_MARKER } from "../src/compaction.js"

const user = (content: string) => ({ role: "user", content })
const assistant = (content: string) => ({ role: "assistant", content })
const boundary = () => ({
  role: "system",
  content: [{ type: "text", text: `${COMPACTION_SUMMARY_MARKER} earlier turns summarized` }],
})

describe("historyAfterLastCompactionCarries — boundary-stopped forward scan", () => {
  it("finds content anywhere in a history without a boundary", () => {
    const history = [user("hello"), assistant("hi"), user("id sess-7 here")]
    expect(historyAfterLastCompactionCarries(history, "sess-7")).toBe(true)
  })

  it("treats content summarized away BEFORE the last boundary as absent", () => {
    const history = [
      user("my session is sess-7"),
      assistant("noted"),
      boundary(), // everything above is summarized away
      user("continue"),
    ]
    expect(historyAfterLastCompactionCarries(history, "sess-7")).toBe(false)
  })

  it("finds content AFTER the last boundary", () => {
    const history = [user("my session is sess-7"), boundary(), user("still sess-7, by the way")]
    expect(historyAfterLastCompactionCarries(history, "sess-7")).toBe(true)
  })

  it("scans only after the LAST boundary, not earlier ones", () => {
    const history = [
      boundary(),
      user("old mention of sess-7 got dropped with this boundary"),
      boundary(), // the mention above is now summarized away
      user("nothing here"),
    ]
    expect(historyAfterLastCompactionCarries(history, "sess-7")).toBe(false)
  })

  it("an empty needle never matches", () => {
    expect(historyAfterLastCompactionCarries([user("anything")], "")).toBe(false)
  })
})

describe("shouldInjectSessionIdentity — inject-once gate", () => {
  it("requests injection when the id is absent after the last boundary", () => {
    expect(shouldInjectSessionIdentity([user("nothing"), assistant("here")], "sess-9")).toBe(true)
    expect(shouldInjectSessionIdentity([user("old sess-9"), boundary()], "sess-9")).toBe(true)
  })

  it("suppresses injection when history (or a prior reminder) carries the id", () => {
    expect(shouldInjectSessionIdentity([user("sess-9 please")], "sess-9")).toBe(false)
    expect(
      shouldInjectSessionIdentity(
        [boundary(), assistant(sessionIdentityReminder("sess-9"))],
        "sess-9",
      ),
    ).toBe(false)
  })

  it("refuses an empty session id", () => {
    expect(shouldInjectSessionIdentity([user("x")], "")).toBe(false)
  })

  it("renders the canonical reminder text with the stable prefix", () => {
    expect(sessionIdentityReminder("s1")).toBe(`${SESSION_IDENTITY_REMINDER_PREFIX} s1`)
  })
})

describe("SingleOwnerInjectionGate — exactly one injector per reminder", () => {
  it("the first claimer owns the key; a second hook is refused", () => {
    const gate = new SingleOwnerInjectionGate()
    expect(gate.claim("session-identity", "tool-loop-hook")).toBe(true)
    expect(gate.claim("session-identity", "post-compaction-hook")).toBe(false)
    expect(gate.ownerOf("session-identity")).toBe("tool-loop-hook")
  })

  it("the owner may claim again (per-turn reminders re-inject every model call)", () => {
    const gate = new SingleOwnerInjectionGate()
    expect(gate.claim("budget", "tool-loop-hook")).toBe(true)
    expect(gate.claim("budget", "tool-loop-hook")).toBe(true)
  })

  it("keys are independent", () => {
    const gate = new SingleOwnerInjectionGate()
    expect(gate.claim("a", "hook-1")).toBe(true)
    expect(gate.claim("b", "hook-2")).toBe(true)
  })

  it("only the owner can release, and release enables a new owner", () => {
    const gate = new SingleOwnerInjectionGate()
    gate.claim("k", "hook-1")
    expect(gate.release("k", "hook-2")).toBe(false)
    expect(gate.release("k", "hook-1")).toBe(true)
    expect(gate.ownerOf("k")).toBeUndefined()
    expect(gate.claim("k", "hook-2")).toBe(true)
  })
})
