import { describe, it, expect } from "vitest"
import { StallDetector, DOOM_LOOP_THRESHOLD } from "../src/stall-detection.js"

describe("StallDetector", () => {
  it("does not stall when progress is made", () => {
    const d = new StallDetector({ maxIdleRounds: 3 })
    d.observe({ completedTasks: 1, newResults: 0 })
    d.observe({ completedTasks: 0, newResults: 1 })
    d.observe({ completedTasks: 0, newResults: 0 })
    expect(d.isStalled()).toBe(false)
  })

  it("stalls after maxIdleRounds consecutive idle observations", () => {
    const d = new StallDetector({ maxIdleRounds: 3 })
    expect(d.observe({ completedTasks: 0, newResults: 0 })).toBe(false)
    expect(d.observe({ completedTasks: 0, newResults: 0 })).toBe(false)
    expect(d.observe({ completedTasks: 0, newResults: 0 })).toBe(true)
    expect(d.isStalled()).toBe(true)
  })

  it("resets idle counter on progress", () => {
    const d = new StallDetector({ maxIdleRounds: 3 })
    d.observe({ completedTasks: 0, newResults: 0 })
    d.observe({ completedTasks: 0, newResults: 0 })
    d.observe({ completedTasks: 1, newResults: 0 }) // progress
    expect(d.isStalled()).toBe(false)
    expect(d.getIdleRounds()).toBe(0)
  })

  it("fires onStall callback", () => {
    let info: unknown = null
    const d = new StallDetector({
      maxIdleRounds: 2,
      onStall: (i) => {
        info = i
      },
    })
    d.observe({ completedTasks: 0, newResults: 0 })
    d.observe({ completedTasks: 0, newResults: 0 })
    expect(info).not.toBeNull()
    expect((info as { idleRounds: number }).idleRounds).toBe(2)
  })

  it("reset clears stalled state", () => {
    const d = new StallDetector({ maxIdleRounds: 2 })
    d.observe({ completedTasks: 0, newResults: 0 })
    d.observe({ completedTasks: 0, newResults: 0 })
    expect(d.isStalled()).toBe(true)
    d.reset()
    expect(d.isStalled()).toBe(false)
    expect(d.getIdleRounds()).toBe(0)
  })

  it("getReplanStrategy returns skip-stalled when stalled", () => {
    const d = new StallDetector({ maxIdleRounds: 1 })
    d.observe({ completedTasks: 0, newResults: 0 })
    expect(d.getReplanStrategy()).toBe("skip-stalled")
  })

  it("getReplanStrategy returns abort after many rounds", () => {
    const d = new StallDetector({ maxIdleRounds: 1 })
    // Simulate 25 rounds (21 idle to stall, then a few more)
    for (let i = 0; i < 25; i++) {
      d.observe({ completedTasks: 0, newResults: 0 })
    }
    expect(d.getReplanStrategy()).toBe("abort")
  })

  it("tracks total rounds", () => {
    const d = new StallDetector({ maxIdleRounds: 10 })
    for (let i = 0; i < 5; i++) {
      d.observe({ completedTasks: 1, newResults: 0 })
    }
    expect(d.getTotalRounds()).toBe(5)
  })
})

// 借鉴 opencode - SessionProcessor.DOOM_LOOP_THRESHOLD 同工具死循环拦截
describe("StallDetector (借鉴 opencode - DOOM_LOOP)", () => {
  it(`detects doom loop when same tool called ${DOOM_LOOP_THRESHOLD}x consecutively`, () => {
    const d = new StallDetector({ maxIdleRounds: 10 })
    const snap = { completedTasks: 0, newResults: 0, recentToolCalls: ["bash"] }
    expect(d.observe(snap)).toBe(false)
    expect(d.observe(snap)).toBe(false)
    // 第 3 次相同工具 → tool-loop-detected
    const r = d.observe(snap)
    expect(r).toBe(true)
    expect(d.isStalled()).toBe(true)
    expect(d.getStallInfo()?.reason).toBe("tool-loop-detected")
  })

  it("does NOT trigger doom loop for only 2 consecutive same-tool calls", () => {
    const d = new StallDetector({ maxIdleRounds: 10 })
    const snap = { completedTasks: 0, newResults: 0, recentToolCalls: ["bash"] }
    d.observe(snap)
    d.observe(snap)
    expect(d.isStalled()).toBe(false)
  })

  it("does NOT trigger doom loop when tool sequence varies", () => {
    const d = new StallDetector({ maxIdleRounds: 10 })
    d.observe({ completedTasks: 0, newResults: 0, recentToolCalls: ["bash"] })
    d.observe({ completedTasks: 0, newResults: 0, recentToolCalls: ["read"] })
    d.observe({ completedTasks: 0, newResults: 0, recentToolCalls: ["bash"] })
    expect(d.isStalled()).toBe(false)
  })

  it("progress resets tool buffer (借鉴 opencode)", () => {
    const d = new StallDetector({ maxIdleRounds: 10 })
    d.observe({ completedTasks: 0, newResults: 0, recentToolCalls: ["bash"] })
    d.observe({ completedTasks: 0, newResults: 0, recentToolCalls: ["bash"] })
    // progress clears the doom buffer
    d.observe({ completedTasks: 1, newResults: 0 })
    // fresh two same-tool calls should not be enough to trigger
    d.observe({ completedTasks: 0, newResults: 0, recentToolCalls: ["bash"] })
    d.observe({ completedTasks: 0, newResults: 0, recentToolCalls: ["bash"] })
    expect(d.isStalled()).toBe(false)
  })

  it("recordToolCall() is alternative API for doom detection", () => {
    const d = new StallDetector({ maxIdleRounds: 10 })
    d.recordToolCall("edit")
    d.recordToolCall("edit")
    expect(d.isInDoomLoop()).toBe(false)
    d.recordToolCall("edit")
    expect(d.isInDoomLoop()).toBe(true)
  })

  it("reset() clears doom buffer", () => {
    const d = new StallDetector({ maxIdleRounds: 10 })
    d.recordToolCall("bash")
    d.recordToolCall("bash")
    d.recordToolCall("bash")
    expect(d.isInDoomLoop()).toBe(true)
    d.reset()
    expect(d.isInDoomLoop()).toBe(false)
  })

  it("doom loop fires BEFORE idle threshold (priority)", () => {
    const d = new StallDetector({ maxIdleRounds: 5 })
    // 3 次同工具在 idle=5 之前就触发 doom
    const snap = { completedTasks: 0, newResults: 0, recentToolCalls: ["bash"] }
    d.observe(snap)
    d.observe(snap)
    d.observe(snap)
    expect(d.isStalled()).toBe(true)
    expect(d.getStallInfo()?.reason).toBe("tool-loop-detected")
  })

  it("DOOM_LOOP_THRESHOLD constant = 3", () => {
    expect(DOOM_LOOP_THRESHOLD).toBe(3)
  })
})
