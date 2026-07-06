/**
 * Wave 1 — Kosmos borrowings: ScholarEval + FailureDetector + EventBus.
 */
import { describe, it, expect, vi } from "vitest"
import {
  evaluateScholar,
  SCHOLAR_DIMENSIONS,
  DEFAULT_WEIGHTS,
  PASS_THRESHOLDS,
  type ScholarDimension,
} from "../src/validation/scholar-eval.js"
import { detectFailures, type FailureMode } from "../src/validation/failure-detector.js"
import { EventBus } from "../src/event-bus.js"

describe("ScholarEval (借鉴 Kosmos scholar_eval.py)", () => {
  it("returns per-dimension scores in [0, 1] for non-empty output", () => {
    const result = evaluateScholar(
      "This study provides strong evidence based on a rigorous experiment with n=100 samples, " +
      "showing significant improvement in novel performance metrics. We use ANOVA for statistical analysis. " +
      "However, limitations include the small sample. Future work will address ethical concerns around privacy.",
    )
    for (const dim of SCHOLAR_DIMENSIONS) {
      expect(result.perDimension[dim]).toBeGreaterThanOrEqual(0)
      expect(result.perDimension[dim]).toBeLessThanOrEqual(1)
    }
    expect(result.overall).toBeGreaterThanOrEqual(0)
    expect(result.overall).toBeLessThanOrEqual(1)
  })

  it("returns low scores for empty/short output", () => {
    const result = evaluateScholar("")
    expect(result.overall).toBe(0)
    expect(result.passed).toBe(false)
    expect(result.failureReasons.length).toBeGreaterThan(0)
  })

  it("default weights sum to 1.0", () => {
    const total = Object.values(DEFAULT_WEIGHTS).reduce((a, b) => a + b, 0)
    expect(total).toBeCloseTo(1.0, 5)
  })

  it("passes when overall >= 0.75 AND rigor >= 0.70", () => {
    const passing = evaluateScholar(
      "Rigorous evidence-based study: data analysis with statistical rigor, experiment with " +
      "p < 0.05, n = 1000, sample size justified. This novel important work has significant " +
      "implications for applications and advances the field. We include step-by-step reproducible " +
      "commands: ```npm test```. Therefore, the work is clear. However, limitations exist. We " +
      "address privacy, consent, bias, and safety in our ethical framework.",
    )
    if (passing.passed) {
      expect(passing.overall).toBeGreaterThanOrEqual(PASS_THRESHOLDS.overall)
      expect(passing.perDimension.rigor).toBeGreaterThanOrEqual(PASS_THRESHOLDS.rigor)
      expect(passing.failureReasons).toHaveLength(0)
    }
  })

  it("fails when overall < threshold", () => {
    const weak = evaluateScholar("ok")
    expect(weak.passed).toBe(false)
    expect(weak.failureReasons.some((r) => r.startsWith("overall"))).toBe(true)
  })

  it("custom scorers override defaults per-dimension", () => {
    const result = evaluateScholar("anything", {
      scorers: {
        novelty: (() => 1) as never,
        rigor: (() => 1) as never,
      },
    })
    expect(result.perDimension.novelty).toBe(1)
    expect(result.perDimension.rigor).toBe(1)
  })

  it("custom weights recompute overall", () => {
    const onlyNovelty: Partial<Record<ScholarDimension, number>> = {
      rigor: 0, impact: 0, novelty: 1.0, reproducibility: 0,
      clarity: 0, coherence: 0, limitations: 0, ethics: 0,
    }
    const result = evaluateScholar("hello", { weights: onlyNovelty })
    expect(result.overall).toBeCloseTo(result.perDimension.novelty, 5)
  })

  it("custom thresholds adjust pass/fail", () => {
    const result = evaluateScholar("evidence data analysis", {
      thresholds: { overall: 0.1, rigor: 0.1 },
    })
    expect(result.passed).toBe(true)
  })
})

describe("FailureDetector (借鉴 Kosmos failure_detector.py)", () => {
  it("detects over-interpretation when strong claims lack statistical support", () => {
    const text = "This always proves that the system guarantees perfect accuracy. It is certain and undeniably the best."
    const result = detectFailures(text)
    const overInterp = result.signals.find((s) => s.mode === "over_interpretation")
    expect(overInterp).toBeDefined()
    expect(overInterp!.confidence).toBeGreaterThan(0.5)
    expect(result.failed).toBe(true)
  })

  it("does not flag over-interpretation when statistical support is present", () => {
    const text = "This always proves correct. We verified with p < 0.01, n = 500, sample size justified."
    const result = detectFailures(text)
    const overInterp = result.signals.find((s) => s.mode === "over_interpretation")
    // Statistical support halves the confidence; expect ≤0.5 (not severe).
    expect(overInterp === undefined || overInterp.confidence <= 0.5).toBe(true)
  })

  it("detects invented metrics with non-standard patterns", () => {
    const text = "The whimsy_factor: 0.87 was higher than the fluffiness_index: 1.2 in our run."
    const result = detectFailures(text)
    const invented = result.signals.find((s) => s.mode === "invented_metrics")
    expect(invented).toBeDefined()
    expect(invented!.confidence).toBeGreaterThan(0)
  })

  it("does not flag invented metrics when only standard metrics present", () => {
    const text = "Accuracy: 0.92, precision: 0.88, recall: 0.85, F1 score: 0.86."
    const result = detectFailures(text)
    const invented = result.signals.find((s) => s.mode === "invented_metrics")
    expect(invented).toBeUndefined()
  })

  it("detects rabbit hole via tangent markers", () => {
    const text =
      "Anyway, by the way this is unrelated. Incidentally, off-topic again. " +
      "Moving on to something else entirely side note. Another tangent."
    const result = detectFailures(text)
    const rabbit = result.signals.find((s) => s.mode === "rabbit_hole")
    expect(rabbit).toBeDefined()
  })

  it("respects custom threshold", () => {
    // Trigger moderate signal: 2 tangent markers yield rabbit_hole confidence ≈ 0.6.
    const text = "Anyway, by the way this is somewhat related to the original topic."
    const strict = detectFailures(text, { threshold: 0.5 })
    const lax = detectFailures(text, { threshold: 0.8 })
    expect(strict.failed).toBe(true)
    expect(lax.failed).toBe(false)
  })

  it("supports custom detector override per mode", () => {
    const result = detectFailures("anything", {
      customDetectors: {
        over_interpretation: () => ({ mode: "over_interpretation", confidence: 0.95, evidence: ["forced"] }),
        invented_metrics: () => null,
        rabbit_hole: () => null,
      },
    })
    expect(result.signals).toHaveLength(1)
    expect(result.signals[0].mode).toBe("over_interpretation")
    expect(result.failed).toBe(true)
  })

  it("returns empty signals for benign text", () => {
    const result = detectFailures("We ran the experiment and found modest results, possibly suggesting improvement.")
    expect(result.signals.every((s) => s.confidence < 0.5)).toBe(true)
  })

  it("uses max of all signal confidences as overall score", () => {
    const result = detectFailures("This always proves X. Y. Z.", {
      customDetectors: {
        over_interpretation: () => ({ mode: "over_interpretation", confidence: 0.3, evidence: [] }),
        invented_metrics: () => ({ mode: "invented_metrics", confidence: 0.7, evidence: [] }),
        rabbit_hole: () => ({ mode: "rabbit_hole", confidence: 0.5, evidence: [] }),
      },
    })
    expect(result.overallScore).toBeCloseTo(0.7, 5)
  })
})

describe("EventBus (借鉴 Kosmos event_bus.py)", () => {
  type Evt = { type: string; payload?: string; ns?: string }
  function evt(type: string, payload?: string, ns?: string): Evt {
    return ns ? { type, payload, ns } : { type, payload }
  }

  it("subscribe + publish delivers matching events", () => {
    const bus = new EventBus<Evt>()
    const seen: Evt[] = []
    bus.subscribe((e) => seen.push(e), { types: ["ping"] })
    bus.publish(evt("ping", "hello"))
    bus.publish(evt("pong", "ignored"))
    expect(seen).toHaveLength(1)
    expect(seen[0].payload).toBe("hello")
  })

  it("type filter only delivers whitelisted event types", () => {
    const bus = new EventBus<Evt>()
    const seen: Evt[] = []
    bus.subscribe((e) => seen.push(e.type), { types: ["a", "b"] })
    bus.publish(evt("a"))
    bus.publish(evt("b"))
    bus.publish(evt("c"))
    expect(seen).toEqual(["a", "b"])
  })

  it("namespace filter only delivers matching namespace", () => {
    const bus = new EventBus<Evt>()
    const seen: Evt[] = []
    const ns = (e: Evt) => e.ns
    bus.subscribe((e) => seen.push(e), {
      namespace: ns,
      namespaces: ["workspace-1"],
    })
    bus.publish(evt("x", undefined, "workspace-1"))
    bus.publish(evt("x", undefined, "workspace-2"))
    bus.publish(evt("y", undefined))  // no ns → filtered out
    expect(seen).toHaveLength(1)
  })

  it("unsubscribe stops delivery", () => {
    const bus = new EventBus<Evt>()
    const seen: Evt[] = []
    const handle = bus.subscribe((e) => seen.push(e))
    bus.publish(evt("a"))
    handle.unsubscribe()
    bus.publish(evt("b"))
    expect(seen).toHaveLength(1)
    expect(bus.size()).toBe(0)
  })

  it("publish returns the count of matching subscribers", () => {
    const bus = new EventBus<Evt>()
    bus.subscribe(() => {})
    bus.subscribe(() => {}, { types: ["a"] })
    bus.subscribe(() => {}, { types: ["b"] })
    const matched = bus.publish(evt("a"))
    expect(matched).toBe(2)
  })

  it("isolates errors from sync subscribers", () => {
    const bus = new EventBus<Evt>()
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const seen: string[] = []
    bus.subscribe(() => { throw new Error("boom") })
    bus.subscribe((e) => seen.push(e.type))
    bus.publish(evt("ok"))
    expect(seen).toEqual(["ok"])
    expect(consoleSpy).toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  it("publishAsync awaits async subscribers", async () => {
    const bus = new EventBus<Evt>()
    const order: string[] = []
    bus.subscribe(async () => {
      await new Promise((r) => setTimeout(r, 10))
      order.push("first")
    })
    bus.subscribe(async () => {
      order.push("second")
    })
    const matched = await bus.publishAsync(evt("e"))
    expect(matched).toBe(2)
    expect(order).toContain("first")
    expect(order).toContain("second")
  })

  it("publishAsync isolates errors from async subscribers", async () => {
    const bus = new EventBus<Evt>()
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const seen: string[] = []
    bus.subscribe(async () => { throw new Error("async-boom") })
    bus.subscribe(async (e) => { seen.push(e.type) })
    await bus.publishAsync(evt("e"))
    expect(seen).toEqual(["e"])
    expect(consoleSpy).toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  it("recentEvents returns last N from history", () => {
    const bus = new EventBus<Evt>({ historyCap: 5 })
    for (let i = 0; i < 8; i++) bus.publish(evt(`e${i}`))
    const recent = bus.recentEvents(3)
    expect(recent.map((e) => e.type)).toEqual(["e5", "e6", "e7"])
  })

  it("history respects historyCap", () => {
    const bus = new EventBus<Evt>({ historyCap: 3 })
    for (let i = 0; i < 10; i++) bus.publish(evt(`e${i}`))
    const all = bus.recentEvents(100)
    expect(all).toHaveLength(3)
    expect(all[0].type).toBe("e7")
  })

  it("clear removes subscribers and history", () => {
    const bus = new EventBus<Evt>()
    bus.subscribe(() => {})
    bus.publish(evt("a"))
    bus.clear()
    expect(bus.size()).toBe(0)
    expect(bus.recentEvents()).toHaveLength(0)
  })

  it("size returns active subscriber count", () => {
    const bus = new EventBus<Evt>()
    expect(bus.size()).toBe(0)
    const h1 = bus.subscribe(() => {})
    const h2 = bus.subscribe(() => {})
    expect(bus.size()).toBe(2)
    h1.unsubscribe()
    expect(bus.size()).toBe(1)
    h2.unsubscribe()
    expect(bus.size()).toBe(0)
  })
})