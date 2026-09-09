import { describe, it, expect } from "vitest"
import {
  SessionStatusTracker,
  canTransition,
  type RetryAction,
} from "../src/session-status.js"

describe("SessionStatus FSM (借鉴 opencode)", () => {
  it("starts idle", () => {
    expect(new SessionStatusTracker().current).toBe("idle")
  })

  it("idle -> busy allowed", () => {
    expect(canTransition("idle", "busy")).toBe(true)
  })

  it("busy -> idle allowed", () => {
    expect(canTransition("busy", "idle")).toBe(true)
  })

  it("busy -> retry allowed", () => {
    expect(canTransition("busy", "retry")).toBe(true)
  })

  it("retry -> retry allowed (retry 计数递增)", () => {
    expect(canTransition("retry", "retry")).toBe(true)
  })

  it("retry -> idle allowed", () => {
    expect(canTransition("retry", "idle")).toBe(true)
  })

  it("idle -> retry NOT allowed (must go through busy)", () => {
    expect(canTransition("idle", "retry")).toBe(false)
  })

  it("idle -> idle NOT allowed", () => {
    expect(canTransition("idle", "idle")).toBe(false)
  })

  it("busy -> busy NOT allowed", () => {
    expect(canTransition("busy", "busy")).toBe(false)
  })

  it("tracker throws on illegal transition", () => {
    const t = new SessionStatusTracker()
    expect(() => t.transition("retry")).toThrow(/Invalid transition/)
  })

  it("retry carries attempt + next + message", () => {
    const t = new SessionStatusTracker()
    t.transition("busy")
    const s = t.transition("retry", { attempt: 2, message: "rate limit", next: 1500 })
    expect(s.type).toBe("retry")
    expect((s as { attempt: number }).attempt).toBe(2)
    expect((s as { next: number }).next).toBe(1500)
    expect((s as { message: string }).message).toBe("rate limit")
  })

  it("retry can carry optional RetryAction", () => {
    const t = new SessionStatusTracker()
    t.transition("busy")
    const action: RetryAction = {
      reason: "free_tier_limit",
      provider: "anthropic",
      title: "Free tier exhausted",
      message: "Subscribe to Go for reliable access",
      label: "Subscribe",
      link: "https://opencode.ai/go",
    }
    const s = t.transition("retry", { attempt: 1, message: "limit", next: 1000, action })
    expect((s as { action: RetryAction }).action.link).toBe("https://opencode.ai/go")
  })

  it("busy transitions return bare type (no info spread)", () => {
    const t = new SessionStatusTracker()
    const s = t.transition("busy")
    expect(s.type).toBe("busy")
  })

  it("busy transition ignores any passed info (no type-unsafe spread)", () => {
    // 借鉴 opencode - busy 不携带 attempt/message/next,这些字段仅 retry 使用
    const t = new SessionStatusTracker()
    // @ts-expect-error - 故意传入 retry 字段,验证 busy 不接收
    const s = t.transition("busy", { attempt: 5, message: "x", next: 1000 })
    expect(s.type).toBe("busy")
    expect((s as Record<string, unknown>).attempt).toBeUndefined()
    expect((s as Record<string, unknown>).message).toBeUndefined()
    expect((s as Record<string, unknown>).next).toBeUndefined()
  })

  it("reset returns to idle", () => {
    const t = new SessionStatusTracker()
    t.transition("busy")
    t.transition("retry", { attempt: 1, message: "x", next: 100 })
    t.reset()
    expect(t.current).toBe("idle")
    expect(t.snapshot().type).toBe("idle")
  })

  it("snapshot returns current state", () => {
    const t = new SessionStatusTracker()
    expect(t.snapshot().type).toBe("idle")
    t.transition("busy")
    expect(t.snapshot().type).toBe("busy")
  })

  it("full lifecycle: idle -> busy -> retry -> retry -> idle", () => {
    const t = new SessionStatusTracker()
    expect(t.current).toBe("idle")
    t.transition("busy")
    expect(t.current).toBe("busy")
    t.transition("retry", { attempt: 1, message: "1", next: 100 })
    expect(t.current).toBe("retry")
    t.transition("retry", { attempt: 2, message: "2", next: 200 })
    expect(t.current).toBe("retry")
    t.transition("idle")
    expect(t.current).toBe("idle")
  })
})