import { describe, it, expect } from "vitest"
import { Flow } from "../src/flow.js"

describe("Flow DSL", () => {
  it("runs independent steps concurrently", async () => {
    const order: string[] = []
    const flow = new Flow("test")
    flow.step("a", async () => { await delay(10); order.push("a"); return "A" })
    flow.step("b", async () => { await delay(5); order.push("b"); return "B" })

    const result = await flow.run()
    expect(result.status).toBe("completed")
    expect(result.results.a).toBe("A")
    expect(result.results.b).toBe("B")
    // Both ran (order may vary due to timing)
    expect(order).toContain("a")
    expect(order).toContain("b")
  })

  it("respects dependencies", async () => {
    const order: string[] = []
    const flow = new Flow("deps")
    flow.step("fetch", async () => { order.push("fetch"); return 42 })
    flow.step("process", async ({ priorResults }) => {
      order.push("process")
      return priorResults.fetch * 2
    }, { dependsOn: ["fetch"] })

    const result = await flow.run()
    expect(result.status).toBe("completed")
    expect(result.results.process).toBe(84)
    expect(order.indexOf("fetch")).toBeLessThan(order.indexOf("process"))
  })

  it("skips steps whose dependencies failed", async () => {
    const flow = new Flow("skip")
    flow.step("fail", async () => { throw new Error("boom") })
    flow.step("after", async () => "ok", { dependsOn: ["fail"] })

    const result = await flow.run()
    expect(result.status).toBe("failed")
    expect(result.errors.fail).toBe("boom")
    expect(result.skipped).toContain("after")
  })

  it("skips steps when condition returns false", async () => {
    const flow = new Flow("cond")
    flow.step("check", async () => ({ score: 0.5 }))
    flow.step("review", async () => "reviewed", {
      dependsOn: ["check"],
      condition: (prev) => (prev.check as { score: number }).score < 0.8,
    })

    const result = await flow.run()
    expect(result.status).toBe("completed")
    expect(result.results.review).toBe("reviewed")
  })

  it("skips steps when condition returns false", async () => {
    const flow = new Flow("cond-skip")
    flow.step("check", async () => ({ score: 0.9 }))
    flow.step("review", async () => "reviewed", {
      dependsOn: ["check"],
      condition: (prev) => (prev.check as { score: number }).score < 0.8,
    })

    const result = await flow.run()
    expect(result.status).toBe("completed")
    expect(result.results.review).toBeUndefined()
    expect(result.skipped).toContain("review")
  })

  it("tracks duration", async () => {
    const flow = new Flow("timing")
    flow.step("slow", async () => { await delay(50); return "done" })

    const result = await flow.run()
    expect(result.durationMs).toBeGreaterThanOrEqual(40)
    expect(result.status).toBe("completed")
  })

  it("throws on duplicate step names", () => {
    const flow = new Flow("dup")
    flow.step("x", async () => 1)
    expect(() => flow.step("x", async () => 2)).toThrow('step "x" already registered')
  })
})

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
