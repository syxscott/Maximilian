import { describe, it, expect } from "vitest"
import { StallDetector } from "../src/stall-detection.js"

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
      onStall: (i) => { info = i },
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
