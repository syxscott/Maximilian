/**
 * 三态 stall detection (借鉴 autogen Magentic-One).
 *
 * The original StallDetector only knew "idle" (zero progress). We borrow
 * autogen's three-state signal: is_progress_being_made (idle) vs is_in_loop
 * (loop-detected). A "loop" is detected when the last N consecutive rounds
 * produce the same output fingerprint (4-gram hash).
 *
 * Verifies:
 *   - loop-detected fires when recentOutputs are identical for LOOP_WINDOW rounds
 *   - loop-detected does NOT fire when outputs change between rounds
 *   - loop-detected does NOT fire without recentOutputs (back-compat)
 *   - idle still fires when no progress AND no outputs provided
 *   - reset clears the loop buffer
 *   - progress breaks the loop even with repeated outputs
 */
import { describe, it, expect } from "vitest"
import { StallDetector, type ProgressSnapshot } from "../src/stall-detection.js"

describe("三态 stall — loop-detected signal (借鉴 autogen Magentic-One)", () => {
  it("fires loop-detected when recentOutputs are identical for 3 consecutive rounds", () => {
    const d = new StallDetector({ maxIdleRounds: 3 })
    // Round 1-3: each produces identical outputs → loop window fills → fires.
    expect(d.observe({ completedTasks: 0, newResults: 0, recentOutputs: ["hello"] })).toBe(false)
    expect(d.observe({ completedTasks: 0, newResults: 0, recentOutputs: ["hello"] })).toBe(false)
    const fired = d.observe({ completedTasks: 0, newResults: 0, recentOutputs: ["hello"] })
    expect(fired).toBe(true)
    expect(d.isStalled()).toBe(true)
    const info = d.getStallInfo()!
    expect(info.reason).toBe("loop-detected")
  })

  it("does NOT fire loop-detected when outputs change between rounds", () => {
    const d = new StallDetector({ maxIdleRounds: 5 })
    d.observe({ completedTasks: 0, newResults: 0, recentOutputs: ["step 1"] })
    d.observe({ completedTasks: 0, newResults: 0, recentOutputs: ["step 2"] })
    d.observe({ completedTasks: 0, newResults: 0, recentOutputs: ["step 3"] })
    // Loop window has 3 different fingerprints → no loop, not stalled yet.
    expect(d.isStalled()).toBe(false)
  })

  it("does NOT fire loop-detected without recentOutputs (back-compat)", () => {
    const d = new StallDetector({ maxIdleRounds: 3 })
    d.observe({ completedTasks: 0, newResults: 0 })
    d.observe({ completedTasks: 0, newResults: 0 })
    d.observe({ completedTasks: 0, newResults: 0 })
    expect(d.isStalled()).toBe(true)
    const info = d.getStallInfo()!
    // Without recentOutputs, the buffer stays empty → falls through to "idle".
    expect(info.reason).toBe("idle")
  })

  it("idle still fires when progress=0 and no recentOutputs provided", () => {
    const d = new StallDetector({ maxIdleRounds: 2 })
    expect(d.observe({ completedTasks: 0, newResults: 0 })).toBe(false)
    expect(d.observe({ completedTasks: 0, newResults: 0 })).toBe(true)
    expect(d.getStallInfo()!.reason).toBe("idle")
  })

  it("reset clears the loop buffer", () => {
    const d = new StallDetector({ maxIdleRounds: 3 })
    d.observe({ completedTasks: 0, newResults: 0, recentOutputs: ["same"] })
    d.observe({ completedTasks: 0, newResults: 0, recentOutputs: ["same"] })
    d.reset()
    // After reset, the buffer is empty so we need 3 MORE identical outputs.
    d.observe({ completedTasks: 0, newResults: 0, recentOutputs: ["same"] })
    d.observe({ completedTasks: 0, newResults: 0, recentOutputs: ["same"] })
    expect(d.isStalled()).toBe(false)
    d.observe({ completedTasks: 0, newResults: 0, recentOutputs: ["same"] })
    expect(d.isStalled()).toBe(true)
    expect(d.getStallInfo()!.reason).toBe("loop-detected")
  })

  it("progress breaks the loop even with repeated outputs", () => {
    const d = new StallDetector({ maxIdleRounds: 3 })
    d.observe({ completedTasks: 0, newResults: 0, recentOutputs: ["same"] })
    d.observe({ completedTasks: 0, newResults: 0, recentOutputs: ["same"] })
    // Progress resets the loop buffer.
    d.observe({ completedTasks: 1, newResults: 0, recentOutputs: ["same"] })
    expect(d.isStalled()).toBe(false)
    // Start fresh: need 3 more identical rounds.
    expect(d.observe({ completedTasks: 0, newResults: 0, recentOutputs: ["same"] })).toBe(false)
    expect(d.observe({ completedTasks: 0, newResults: 0, recentOutputs: ["same"] })).toBe(false)
    expect(d.observe({ completedTasks: 0, newResults: 0, recentOutputs: ["same"] })).toBe(true)
    expect(d.getStallInfo()!.reason).toBe("loop-detected")
  })

  it("loop-detected increments idleRounds each time", () => {
    const d = new StallDetector({ maxIdleRounds: 3 })
    d.observe({ completedTasks: 0, newResults: 0, recentOutputs: ["x"] })
    d.observe({ completedTasks: 0, newResults: 0, recentOutputs: ["x"] })
    // 3rd round: loop-detected → idleRounds=3
    d.observe({ completedTasks: 0, newResults: 0, recentOutputs: ["x"] })
    expect(d.getStallInfo()!.idleRounds).toBe(3)
    // 4th round: still looping → idleRounds=4 but observe returns false (already stalled)
    d.observe({ completedTasks: 0, newResults: 0, recentOutputs: ["x"] })
    expect(d.getIdleRounds()).toBe(4)
  })

  it("fingerprint differentiates similar outputs", () => {
    const d = new StallDetector({ maxIdleRounds: 5 }) // 5 so we don't hit idle before loop
    d.observe({ completedTasks: 0, newResults: 0, recentOutputs: ["hello world"] })
    d.observe({ completedTasks: 0, newResults: 0, recentOutputs: ["hello world!"] })
    d.observe({ completedTasks: 0, newResults: 0, recentOutputs: ["hello world!!"] })
    // Each output has a different 4-gram signature → no loop.
    expect(d.isStalled()).toBe(false)
  })
})