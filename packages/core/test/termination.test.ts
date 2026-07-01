import { describe, it, expect } from "vitest"
import {
  AndTermination,
  HandoffTermination,
  MaxMessageTermination,
  NeverTermination,
  OrTermination,
  TextMatchTermination,
  TimeoutTermination,
  TokenUsageTermination,
  type TerminationContext,
} from "../src/termination.js"

function ctx(overrides: Partial<TerminationContext> = {}): TerminationContext {
  return {
    workspaceId: "ws-1",
    messagesEmitted: 0,
    tokensConsumed: { input: 0, output: 0, total: 0 },
    startedAt: 0,
    now: 0,
    ...overrides,
  }
}

describe("TerminationCondition", () => {
  it("NeverTermination never stops", () => {
    expect(NeverTermination.check(ctx({ messagesEmitted: 9999 })).stop).toBe(false)
  })

  it("MaxMessageTermination stops at the threshold", () => {
    const cond = MaxMessageTermination(3)
    expect(cond.check(ctx({ messagesEmitted: 2 })).stop).toBe(false)
    expect(cond.check(ctx({ messagesEmitted: 3 })).stop).toBe(true)
  })

  it("TokenUsageTermination stops when budget is exhausted", () => {
    const cond = TokenUsageTermination(1000)
    const v1 = cond.check(ctx({ tokensConsumed: { input: 500, output: 400, total: 900 } }))
    expect(v1.stop).toBe(false)
    const v2 = cond.check(ctx({ tokensConsumed: { input: 800, output: 300, total: 1100 } }))
    expect(v2.stop).toBe(true)
  })

  it("TimeoutTermination stops after the wall-clock window", () => {
    const cond = TimeoutTermination(100)
    expect(cond.check(ctx({ startedAt: 0, now: 99 })).stop).toBe(false)
    const v = cond.check(ctx({ startedAt: 0, now: 100 }))
    expect(v.stop).toBe(true)
  })

  it("HandoffTermination matches the source field", () => {
    const cond = HandoffTermination("orchestrator")
    expect(cond.check(ctx({ lastMessage: { role: "assistant", source: "agent-1" } })).stop).toBe(false)
    const v = cond.check(ctx({ lastMessage: { role: "assistant", source: "orchestrator" } }))
    expect(v.stop).toBe(true)
  })

  it("TextMatchTermination matches content with a regex", () => {
    const cond = TextMatchTermination(/DONE/i)
    expect(cond.check(ctx({ lastMessage: { role: "assistant", content: "still working" } })).stop).toBe(false)
    const v = cond.check(ctx({ lastMessage: { role: "assistant", content: "All done." } }))
    expect(v.stop).toBe(true)
  })

  it("OrTermination triggers if any inner condition fires", () => {
    const cond = OrTermination(MaxMessageTermination(5), TimeoutTermination(100))
    expect(cond.check(ctx({ messagesEmitted: 5, startedAt: 0, now: 0 })).stop).toBe(true)
    expect(cond.check(ctx({ messagesEmitted: 0, startedAt: 0, now: 200 })).stop).toBe(true)
    expect(cond.check(ctx({ messagesEmitted: 0, startedAt: 0, now: 0 })).stop).toBe(false)
  })

  it("AndTermination requires all inner conditions to fire", () => {
    const cond = AndTermination(MaxMessageTermination(5), TimeoutTermination(100))
    expect(cond.check(ctx({ messagesEmitted: 5, startedAt: 0, now: 0 })).stop).toBe(false)
    const v = cond.check(ctx({ messagesEmitted: 5, startedAt: 0, now: 200 }))
    expect(v.stop).toBe(true)
  })
})