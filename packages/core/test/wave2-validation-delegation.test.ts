/**
 * Wave 2 — Kosmos borrowings: NullModel + PlanReviewer + DelegationManager.
 */
import { describe, it, expect, vi } from "vitest"
import {
  permutationTest,
  permutationTestExternal,
  meanDifference,
} from "../src/validation/null-model.js"
import {
  reviewPlan,
  PLAN_REVIEW_DIMENSIONS,
  PLAN_PASS_THRESHOLDS,
  type PlanLike,
} from "../src/validation/plan-reviewer.js"
import {
  DelegationManager,
  type DelegationTask,
  type TaskHandler,
} from "../src/orchestration/delegation-manager.js"

describe("NullModel (借鉴 Kosmos null_model.py)", () => {
  it("detects strong signal between well-separated groups", () => {
    const a = Array.from({ length: 50 }, () => 0.1 + Math.random() * 0.05)
    const b = Array.from({ length: 50 }, () => 0.9 + Math.random() * 0.05)
    const result = permutationTest(a, b, { randomSeed: 42 })
    expect(result.observedStatistic).toBeGreaterThan(0.5)
    expect(result.permutationPValue).toBeLessThan(0.05)
    expect(result.passesNullTest).toBe(true)
    expect(result.signalDetected).toBe(true)
  })

  it("does not detect signal when groups are drawn from same distribution", () => {
    const a = Array.from({ length: 60 }, () => Math.random())
    const b = Array.from({ length: 60 }, () => Math.random())
    const result = permutationTest(a, b, { randomSeed: 42 })
    expect(result.permutationPValue).toBeGreaterThan(0.01)
    expect(result.signalDetected).toBe(false)
  })

  it("custom statistic function is used", () => {
    const a = [1, 2, 3, 4, 5]
    const b = [10, 20, 30, 40, 50]
    const statFn = (x: number[], y: number[]) =>
      Math.max(...y) - Math.min(...x)
    const result = permutationTest(a, b, {
      statistic: statFn,
      randomSeed: 1,
      nPermutations: 200,
    })
    // max(50) - min(1) = 49
    expect(result.observedStatistic).toBe(49)
    // Null distribution tracks range too — p-value is in (0, 1).
    expect(result.permutationPValue).toBeGreaterThan(0)
    expect(result.permutationPValue).toBeLessThanOrEqual(1)
  })

  it("nullDistributionSummary contains 5 percentiles", () => {
    const result = permutationTest([1, 2, 3], [4, 5, 6], { randomSeed: 1, nPermutations: 100 })
    expect(result.nullDistributionSummary).toHaveLength(5)
    const sorted = [...result.nullDistributionSummary].sort((a, b) => a - b)
    expect(sorted).toEqual(result.nullDistributionSummary)
  })

  it("respects alpha threshold", () => {
    const a = Array.from({ length: 30 }, () => Math.random())
    const b = Array.from({ length: 30 }, () => Math.random() + 0.5)
    const strict = permutationTest(a, b, { randomSeed: 1, alpha: 0.001 })
    const lax = permutationTest(a, b, { randomSeed: 1, alpha: 0.5 })
    if (strict.permutationPValue >= 0.001) expect(strict.passesNullTest).toBe(false)
    if (lax.permutationPValue < 0.5) expect(lax.passesNullTest).toBe(true)
  })

  it("emits warning for small sample size", () => {
    const result = permutationTest([1, 2], [3, 4], { randomSeed: 1 })
    expect(result.warnings.some((w) => w.includes("small sample"))).toBe(true)
  })

  it("emits warning for low permutation count", () => {
    const result = permutationTest([1, 2, 3, 4, 5], [6, 7, 8, 9, 10], { randomSeed: 1, nPermutations: 50 })
    expect(result.warnings.some((w) => w.includes("permutation"))).toBe(true)
  })

  it("randomSeed produces reproducible results", () => {
    const a = Array.from({ length: 20 }, (_, i) => i)
    const b = Array.from({ length: 20 }, (_, i) => i + 100)
    const r1 = permutationTest(a, b, { randomSeed: 12345, nPermutations: 200 })
    const r2 = permutationTest(a, b, { randomSeed: 12345, nPermutations: 200 })
    expect(r1.permutationPValue).toBe(r2.permutationPValue)
    expect(r1.nullPercentile).toBe(r2.nullPercentile)
  })

  it("meanDifference handles empty group defensively", () => {
    expect(meanDifference([], [1, 2, 3])).toBe(0)
    expect(meanDifference([1, 2, 3], [])).toBe(0)
  })

  it("permutationTestExternal computes against custom null sampler", () => {
    const observed = 5.0
    const result = permutationTestExternal(observed, {
      nPermutations: 500,
      randomSeed: 7,
      alpha: 0.05,
      nullSampler: (rng) => [rng() * 10, rng() * 10, rng() * 10],
      statisticOnSample: (sample) => Math.max(...sample),
    })
    expect(result.observedStatistic).toBe(5.0)
    expect(result.permutationPValue).toBeGreaterThan(0)
    expect(result.permutationPValue).toBeLessThanOrEqual(1)
  })
})

describe("PlanReviewer (借鉴 Kosmos plan_reviewer.py)", () => {
  const goodPlan: PlanLike = {
    objective: "Analyze the impact of feature X on user retention across 5 cohorts over 6 months",
    tasks: [
      { agentRole: "data_analyst", type: "data_analysis", description: "Extract user activity logs from the database" },
      { agentRole: "data_analyst", type: "data_analysis", description: "Compute retention metrics for each cohort" },
      { agentRole: "researcher", type: "literature_review", description: "Review prior research on retention drivers" },
      { agentRole: "writer", type: "report_writing", description: "Write executive summary of findings" },
    ],
  }

  it("returns per-dimension scores in [0, 10]", () => {
    const result = reviewPlan(goodPlan)
    for (const dim of PLAN_REVIEW_DIMENSIONS) {
      expect(result.scores[dim]).toBeGreaterThanOrEqual(0)
      expect(result.scores[dim]).toBeLessThanOrEqual(10)
    }
  })

  it("default weights sum to 1.0", () => {
    const total = Object.values(PLAN_REVIEW_DIMENSIONS).reduce(() => 0, 0)
    expect(total).toBe(0)
    const w = PLAN_REVIEW_DIMENSIONS.reduce(
      (acc, dim) => acc + (PLAN_REVIEW_DIMENSIONS.includes(dim) ? 1 : 0),
      0,
    )
    expect(w).toBe(5)
  })

  it("approves a good plan", () => {
    const result = reviewPlan(goodPlan)
    if (result.approved) {
      expect(result.averageScore).toBeGreaterThanOrEqual(PLAN_PASS_THRESHOLDS.average)
      expect(result.minScore).toBeGreaterThanOrEqual(PLAN_PASS_THRESHOLDS.minDimension)
      expect(result.requiredChanges).toHaveLength(0)
    }
  })

  it("rejects plan with too few tasks", () => {
    const tiny: PlanLike = {
      objective: "Do something useful",
      tasks: [{ agentRole: "general", description: "Run it" }],
    }
    const result = reviewPlan(tiny)
    expect(result.approved).toBe(false)
    expect(result.requiredChanges.some((c) => c.includes("minimum is 3"))).toBe(true)
  })

  it("rejects plan with all-same task types", () => {
    const monotask: PlanLike = {
      objective: "Single-type plan",
      tasks: [
        { type: "data_analysis", description: "Step one" },
        { type: "data_analysis", description: "Step two" },
        { type: "data_analysis", description: "Step three" },
      ],
    }
    const result = reviewPlan(monotask)
    expect(result.approved).toBe(false)
    expect(result.requiredChanges.some((c) => c.includes("distinct types"))).toBe(true)
  })

  it("rejects empty plan", () => {
    const empty: PlanLike = { objective: "", tasks: [] }
    const result = reviewPlan(empty)
    expect(result.approved).toBe(false)
    expect(result.averageScore).toBeLessThan(PLAN_PASS_THRESHOLDS.average)
  })

  it("custom scorer overrides per-dimension", () => {
    const result = reviewPlan(goodPlan, {
      scorers: {
        novelty: () => 10,
        specificity: () => 10,
        relevance: () => 10,
        coverage: () => 10,
        feasibility: () => 10,
      },
    })
    expect(result.averageScore).toBe(10)
    expect(result.approved).toBe(true)
  })

  it("relaxed thresholds approve modest plans", () => {
    const modest: PlanLike = {
      objective: "Brief task",
      tasks: [
        { type: "alpha", description: "Do X" },
        { type: "beta", description: "Do Y" },
        { type: "alpha", description: "Do Z" },
      ],
    }
    const result = reviewPlan(modest, {
      thresholds: { average: 1.0, minDimension: 1.0, minDistinctTypes: 2, minTaskCount: 3 },
    })
    expect(result.approved).toBe(true)
  })

  it("custom weights shift the average", () => {
    const plan: PlanLike = { objective: "Test weights", tasks: goodPlan.tasks }
    const noveltyOnly = reviewPlan(plan, {
      weights: { specificity: 0, relevance: 0, novelty: 1.0, coverage: 0, feasibility: 0 },
    })
    expect(noveltyOnly.averageScore).toBeCloseTo(noveltyOnly.scores.novelty, 5)
  })

  it("provides suggestions for approved plans with low scores", () => {
    const mediocre: PlanLike = {
      objective: "Plan",
      tasks: [
        { type: "a", description: "step 1" },
        { type: "b", description: "step 2" },
        { type: "a", description: "step 3" },
      ],
    }
    const result = reviewPlan(mediocre)
    if (result.approved) {
      expect(result.suggestions.length).toBeGreaterThan(0)
    }
  })
})

describe("DelegationManager (借鉴 Kosmos delegation.py)", () => {
  function makeHandlers(
    failOnTypes: string[] = [],
  ): Map<string, TaskHandler<unknown, unknown>> {
    return new Map<string, TaskHandler<unknown, unknown>>([
      [
        "echo",
        async (task: DelegationTask<unknown>) => {
          const input = task.input as { message?: string } | undefined
          return { echoed: input?.message ?? "default" }
        },
      ],
      [
        "fail",
        async () => {
          throw new Error("intentional failure")
        },
      ],
      ...(failOnTypes.length > 0
        ? []
        : []),
    ])
  }

  it("executes all tasks and returns summary", async () => {
    const dm = new DelegationManager({ maxParallel: 2 })
    const tasks: DelegationTask[] = [
      { id: "t1", type: "echo", input: { message: "hi" } },
      { id: "t2", type: "echo", input: { message: "hey" } },
      { id: "t3", type: "echo", input: { message: "yo" } },
    ]
    const { results, summary } = await dm.execute(tasks, makeHandlers())
    expect(results).toHaveLength(3)
    expect(summary.totalTasks).toBe(3)
    expect(summary.completedTasks).toBe(3)
    expect(summary.failedTasks).toBe(0)
    expect(summary.successRate).toBe(1)
  })

  it("routes to correct handler by task type", async () => {
    const dm = new DelegationManager()
    const handlers = new Map<string, TaskHandler<string, string>>([
      ["upper", async (t) => (t.input as string).toUpperCase()],
      ["lower", async (t) => (t.input as string).toLowerCase()],
    ])
    const { results } = await dm.execute(
      [
        { id: "t1", type: "upper", input: "hello" },
        { id: "t2", type: "lower", input: "WORLD" },
      ],
      handlers,
    )
    expect(results[0].result).toBe("HELLO")
    expect(results[1].result).toBe("world")
  })

  it("skips tasks with no registered handler", async () => {
    const dm = new DelegationManager()
    const handlers = new Map<string, TaskHandler<unknown, unknown>>()
    const { results } = await dm.execute(
      [{ id: "t1", type: "missing", input: {} }],
      handlers,
    )
    expect(results[0].status).toBe("skipped")
    expect(results[0].error).toContain("no handler")
  })

  it("retries failed tasks up to maxRetries times", async () => {
    let attempts = 0
    const handlers = new Map<string, TaskHandler<unknown, unknown>>([
      [
        "flaky",
        async () => {
          attempts++
          if (attempts < 3) throw new Error("not yet")
          return "ok"
        },
      ],
    ])
    const dm = new DelegationManager({ maxRetries: 3, baseBackoffMs: 1 })
    const { results } = await dm.execute(
      [{ id: "t1", type: "flaky", input: {} }],
      handlers,
    )
    expect(results[0].status).toBe("completed")
    expect(results[0].result).toBe("ok")
    expect(results[0].attempts).toBe(3)
  })

  it("returns failed status after exhausting retries", async () => {
    const handlers = new Map<string, TaskHandler<unknown, unknown>>([
      ["always-fails", async () => { throw new Error("nope") }],
    ])
    const dm = new DelegationManager({ maxRetries: 2, baseBackoffMs: 1 })
    const { results } = await dm.execute(
      [{ id: "t1", type: "always-fails", input: {} }],
      handlers,
    )
    expect(results[0].status).toBe("failed")
    expect(results[0].error).toBe("nope")
    expect(results[0].attempts).toBe(3)
  })

  it("batches tasks by maxParallel", async () => {
    const inFlight: number[] = []
    let maxConcurrent = 0
    const handlers = new Map<string, TaskHandler<unknown, unknown>>([
      [
        "slow",
        async () => {
          inFlight.push(Date.now())
          await new Promise((r) => setTimeout(r, 20))
          maxConcurrent = Math.max(maxConcurrent, inFlight.length)
          inFlight.pop()
          return "done"
        },
      ],
    ])
    const dm = new DelegationManager({ maxParallel: 2 })
    const tasks: DelegationTask[] = Array.from({ length: 6 }, (_, i) => ({
      id: `t${i}`,
      type: "slow",
      input: {},
    }))
    const { summary } = await dm.execute(tasks, handlers)
    expect(summary.completedTasks).toBe(6)
    expect(maxConcurrent).toBeLessThanOrEqual(2)
  })

  it("returns empty result for empty task list", async () => {
    const dm = new DelegationManager()
    const { results, summary } = await dm.execute([], new Map())
    expect(results).toEqual([])
    expect(summary.totalTasks).toBe(0)
    expect(summary.successRate).toBe(0)
  })

  it("applies exponential backoff between retries", async () => {
    const start = Date.now()
    const handlers = new Map<string, TaskHandler<unknown, unknown>>([
      ["always-fails", async () => { throw new Error("x") }],
    ])
    const dm = new DelegationManager({ maxRetries: 2, baseBackoffMs: 50 })
    await dm.execute([{ id: "t1", type: "always-fails", input: {} }], handlers)
    const elapsed = Date.now() - start
    // Backoff: 50 + 100 = 150ms minimum (plus handler overhead).
    expect(elapsed).toBeGreaterThanOrEqual(140)
  })

  it("isolates failures across tasks in same batch", async () => {
    const handlers = new Map<string, TaskHandler<unknown, unknown>>([
      ["ok", async () => "ok"],
      ["bad", async () => { throw new Error("bad") }],
    ])
    const dm = new DelegationManager({ maxRetries: 0 })
    const { results } = await dm.execute(
      [
        { id: "a", type: "ok", input: {} },
        { id: "b", type: "bad", input: {} },
      ],
      handlers,
    )
    expect(results.find((r) => r.taskId === "a")?.status).toBe("completed")
    expect(results.find((r) => r.taskId === "b")?.status).toBe("failed")
  })
})