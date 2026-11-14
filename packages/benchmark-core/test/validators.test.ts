// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Validator-protocol tests (borrowing MiniMax-Provider-Verifier
 * verify.py + validator/*.py):
 *   - registry dispatch / unregistered-check-type degradation / summary
 *     aggregation over 3 fake cases and 2 fake validators
 *   - tool_calls confusion matrix + schema accuracy + denominator priority
 *   - always-on error-only-reasoning check
 *   - scenario key-order probe
 */

import { describe, it, expect, vi } from "vitest"
import { ValidatorRegistry } from "../src/validators/registry.js"
import { ToolCallsValidator } from "../src/validators/tool-calls.js"
import { ScenarioCheckValidator } from "../src/validators/scenario-check.js"
import {
  isErrorOnlyReasoning,
  runErrorOnlyReasoningCheck,
  summarizeErrorOnlyReasoning,
} from "../src/validators/error-only-reasoning.js"
import { BenchmarkEvaluator } from "../src/evaluator.js"
import { computeAggregate } from "../src/types.js"
import type {
  CaseValidator,
  ValidatorCaseContext,
  ValidatorCaseRun,
} from "../src/validators/types.js"
import type { BenchmarkResult, BenchmarkTask } from "../src/types.js"
import type { Provider, ChatResponse } from "@max/providers"

// ── Fixtures ────────────────────────────────────────────────────────────────

function fakeCase(taskId: string, patch: Partial<ValidatorCaseContext> = {}): ValidatorCaseContext {
  return {
    taskId,
    status: "success",
    output: "ok",
    finishReason: "stop",
    ...patch,
  }
}

/** Fake validator A: records its per-case dispatch and its summary size. */
const fakeA: CaseValidator = {
  name: "fake_a",
  validate: (ctx) => ({ fakeAChecked: true, fakeATask: ctx.taskId }),
  computeSummary: (runs) => ({ fakeACount: runs.length }),
}

/** Fake validator B: distinct fields so merge conflicts cannot hide. */
const fakeB: CaseValidator = {
  name: "fake_b",
  validate: () => ({ fakeBChecked: true }),
  computeSummary: (runs) => ({ fakeBCount: runs.length }),
}

// ── A1: registry dispatch / degradation / aggregation ──────────────────────

describe("ValidatorRegistry dispatch", () => {
  it("resolves a check_type array to its validators in order", () => {
    const registry = new ValidatorRegistry(fakeA, fakeB)
    expect(registry.resolve(["fake_b", "fake_a"])).toEqual([fakeB, fakeA])
  })

  it("falls back to the default list when no check types are given", () => {
    const registry = new ValidatorRegistry(fakeA, fakeB)
    expect(registry.resolve(undefined)).toEqual([fakeA, fakeB])
    expect(registry.resolve([])).toEqual([fakeA, fakeB])
  })

  it("warns and degrades an unregistered check type to the default validators", () => {
    const registry = new ValidatorRegistry(fakeA, fakeB)
    const onUnknownCheckType = vi.fn()
    const resolved = registry.resolve(["fake_a", "mystery_check"], { onUnknownCheckType })
    // fake_a dispatches; the unknown slot degrades to the default list.
    expect(resolved).toEqual([fakeA, fakeB])
    expect(onUnknownCheckType).toHaveBeenCalledWith("mystery_check")
  })

  it("deduplicates repeated check types", () => {
    const registry = new ValidatorRegistry(fakeA, fakeB)
    expect(registry.resolve(["fake_a", "fake_a"])).toEqual([fakeA])
  })

  it("reports unregistered names through has/get", () => {
    const registry = new ValidatorRegistry(fakeA)
    expect(registry.has("fake_a")).toBe(true)
    expect(registry.has("tool_calls")).toBe(false)
    expect(registry.get("fake_a")).toBe(fakeA)
  })
})

describe("Evaluator validator wiring (3 fake cases × 2 fake validators)", () => {
  function makeProvider(responses: Record<string, string>): Provider {
    return {
      id: "mock",
      name: "mock",
      defaultModel: "mock-1",
      isConfigured: () => true,
      chat: async (messages): Promise<ChatResponse> => {
        const user = messages.find((m) => m.role === "user")?.content ?? ""
        const key = Object.keys(responses).find((k) => user.includes(k)) ?? ""
        return { content: responses[key] ?? "", model: "mock-1" }
      },
      stream: async function* () {
        yield { delta: "ok", done: true }
      },
    }
  }

  function makeTask(id: string, input: string, checkType?: string[]): BenchmarkTask {
    return {
      id,
      domain: "database",
      difficulty: "easy",
      input,
      context: {
        ddl: "CREATE TABLE t(x INTEGER);",
        goldQuery: "SELECT * FROM t",
        goldResult: [{ x: 1 }],
      },
      expectedOutputAssertion: async () => true,
      ...(checkType ? { checkType } : {}),
    }
  }

  it("runs the default validators per case and merges fields into results", async () => {
    const provider = makeProvider({ t1: "```sql\nSELECT * FROM t;\n```" })
    const evaluator = new BenchmarkEvaluator({
      provider,
      dags: { compose: async () => ({}) } as never,
      validators: [fakeA, fakeB],
    })
    const tasks = [makeTask("t1", "t1"), makeTask("t2", "t2"), makeTask("t3", "t3")]
    const suite = await evaluator.evaluate(tasks)

    for (const r of suite.results) {
      expect(r.validatorFields?.["fake_a"]).toEqual({ fakeAChecked: true, fakeATask: r.taskId })
      expect(r.validatorFields?.["fake_b"]).toEqual({ fakeBChecked: true })
    }
    // Aggregation: each validator summarized over all 3 cases.
    expect(suite.validatorSummaries?.["fake_a"]).toEqual({ fakeACount: 3 })
    expect(suite.validatorSummaries?.["fake_b"]).toEqual({ fakeBCount: 3 })
    // Existing aggregate fields untouched by the validator layer.
    expect(suite.aggregateMetrics.passRate).toBeGreaterThanOrEqual(0)
    expect(suite.aggregateMetrics.avgQuality).toBeGreaterThanOrEqual(0)
  })

  it("dispatches per-case checkType and degrades unknown names to defaults", async () => {
    const warnings: string[] = []
    const provider = makeProvider({ t1: "```sql\nSELECT * FROM t;\n```" })
    const evaluator = new BenchmarkEvaluator({
      provider,
      dags: { compose: async () => ({}) } as never,
      validators: [fakeA, fakeB],
      onValidatorWarning: (m) => warnings.push(m),
    })
    const tasks = [
      makeTask("t1", "t1", ["fake_a"]),
      makeTask("t2", "t2", ["mystery_check"]),
      makeTask("t3", "t3", ["fake_b"]),
    ]
    const suite = await evaluator.evaluate(tasks)

    expect(suite.results[0]!.validatorFields?.["fake_a"]).toBeDefined()
    expect(suite.results[0]!.validatorFields?.["fake_b"]).toBeUndefined()
    // Unknown check_type → warn + degraded to the default list (fake_a + fake_b).
    expect(warnings).toContain("Unknown check_type: mystery_check")
    expect(suite.results[1]!.validatorFields?.["fake_a"]).toBeDefined()
    expect(suite.results[1]!.validatorFields?.["fake_b"]).toBeDefined()
    expect(suite.results[2]!.validatorFields?.["fake_b"]).toBeDefined()
  })

  it("an explicit empty validator list disables the validator layer", async () => {
    const provider = makeProvider({ t1: "```sql\nSELECT * FROM t;\n```" })
    const evaluator = new BenchmarkEvaluator({
      provider,
      dags: { compose: async () => ({}) } as never,
      validators: [],
    })
    const suite = await evaluator.evaluate([makeTask("t1", "t1")])
    expect(suite.results[0]!.validatorFields).toBeUndefined()
    expect(suite.validatorSummaries).toBeUndefined()
  })

  it("the default validator list is [ToolCallsValidator] like verify.py", async () => {
    const provider = makeProvider({ t1: "```sql\nSELECT * FROM t;\n```" })
    const evaluator = new BenchmarkEvaluator({
      provider,
      dags: { compose: async () => ({}) } as never,
    })
    const suite = await evaluator.evaluate([makeTask("t1", "t1")])
    expect(suite.results[0]!.validatorFields?.["tool_calls"]).toBeDefined()
    expect(suite.validatorSummaries?.["tool_calls"]).toBeDefined()
  })
})

// ── A2: tool_calls confusion matrix + schema accuracy ──────────────────────

describe("ToolCallsValidator", () => {
  const tools = [
    {
      type: "function",
      function: {
        name: "search",
        parameters: {
          type: "object",
          properties: { query: { type: "string" }, limit: { type: "number" } },
          required: ["query"],
        },
      },
    },
  ]

  function run(
    ctx: Partial<ValidatorCaseContext>,
    fields?: Record<string, unknown>,
  ): ValidatorCaseRun {
    return { ctx: fakeCase("t", ctx), fields: fields ?? {} }
  }

  function validatedRun(ctx: Partial<ValidatorCaseContext>): ValidatorCaseRun {
    const validator = new ToolCallsValidator()
    const full = fakeCase("t", { tools, ...ctx })
    return { ctx: full, fields: validator.validate(full) as unknown as Record<string, unknown> }
  }

  it("validates a triggered call against the declared schema", () => {
    const validator = new ToolCallsValidator()
    const fields = validator.validate(
      fakeCase("t", {
        finishReason: "tool_calls",
        tools,
        message: {
          toolCalls: [{ function: { name: "search", arguments: '{"query": "x"}' } }],
        },
      }),
    )
    expect(fields).toMatchObject({
      toolCallsFinishReason: "tool_calls",
      toolCallsValid: true,
      toolCallsCount: 1,
    })
  })

  it("flags schema violations (missing required property, bad type, unknown tool)", () => {
    const validator = new ToolCallsValidator()
    const missingRequired = validator.validate(
      fakeCase("t", {
        finishReason: "tool_calls",
        tools,
        message: { toolCalls: [{ function: { name: "search", arguments: '{"limit": 3}' } }] },
      }),
    )
    expect(missingRequired.toolCallsValid).toBe(false)

    const badType = validator.validate(
      fakeCase("t", {
        finishReason: "tool_calls",
        tools,
        message: { toolCalls: [{ function: { name: "search", arguments: '{"query": 42}' } }] },
      }),
    )
    expect(badType.toolCallsValid).toBe(false)

    const unknownTool = validator.validate(
      fakeCase("t", {
        finishReason: "tool_calls",
        tools,
        message: { toolCalls: [{ function: { name: "nope", arguments: "{}" } }] },
      }),
    )
    expect(unknownTool.toolCallsValid).toBe(false)
  })

  it("classifies the expected×finish_reason confusion matrix", () => {
    const validator = new ToolCallsValidator()
    const runs = [
      // TP: expected tool call, triggered, schema-valid.
      validatedRun({
        expectedToolCall: true,
        finishReason: "tool_calls",
        message: { toolCalls: [{ function: { name: "search", arguments: '{"query":"x"}' } }] },
      }),
      // FN: expected tool call, answered with stop.
      validatedRun({ expectedToolCall: true, finishReason: "stop" }),
      // FP: expected no tool call, triggered anyway.
      validatedRun({
        expectedToolCall: false,
        finishReason: "tool_calls",
        message: { toolCalls: [{ function: { name: "search", arguments: '{"query":"y"}' } }] },
      }),
      // TN: expected no tool call, stopped.
      validatedRun({ expectedToolCall: false, finishReason: "stop" }),
      // Other finish reason on a labeled case → detail bucket.
      validatedRun({ expectedToolCall: true, finishReason: "length" }),
      // Unlabeled case → not in the matrix.
      validatedRun({ finishReason: "stop" }),
    ]
    const summary = validator.computeSummary(runs)
    expect(summary.toolCallsTp).toBe(1)
    expect(summary.toolCallsFn).toBe(1)
    expect(summary.toolCallsFp).toBe(1)
    expect(summary.toolCallsTn).toBe(1)
    expect(summary.toolCallsFinishOthers).toBe(1)
    expect(summary.toolCallsFinishOthersDetail).toEqual({ length: 1 })
    expect(summary.expectedToolCallTotalCount).toBe(5)
    // Count distribution tracks the TP branch only (tool_calls.py:142-144).
    expect(summary.toolCallsCountDistribution).toEqual({ "1": 1 })
    // Match rate = (TP + TN) / labeled total = 2 / 5.
    expect(summary.toolCallsMatchRate).toBe(0.4)
    // Schema accuracy is conditional on the EXPECTED trigger actually
    // firing (tool_calls.py: tool_calls_finish_tool_calls is the TP
    // count): 1 valid of the 1 TP case; the FP trigger is excluded.
    expect(summary.toolCallsTriggeredCount).toBe(1)
    expect(summary.toolCallsSuccessfulCount).toBe(1)
    expect(summary.toolCallsSchemaValidationErrorCount).toBe(0)
    expect(summary.toolCallsSchemaAccuracy).toBe(1)
  })

  it("prefers the external label count as match-rate denominator", () => {
    const validator = new ToolCallsValidator()
    // 1 labeled pair (both stop → TN) + 9 unlabeled successes: the
    // denominator must be the labeled count, not the case count.
    const runs = [
      validatedRun({ expectedToolCall: true, finishReason: "stop" }),
      validatedRun({ expectedToolCall: false, finishReason: "stop" }),
      ...Array.from({ length: 9 }, () => validatedRun({ finishReason: "stop" })),
    ]
    const summary = validator.computeSummary(runs)
    expect(summary.expectedToolCallTotalCount).toBe(2)
    // (0 TP + 1 TN) over the 2 labeled cases — not over all 11 successes.
    expect(summary.toolCallsMatchRate).toBe(0.5)
  })

  it("reports no match rate and no schema accuracy without labels / triggers", () => {
    const validator = new ToolCallsValidator()
    const summary = validator.computeSummary([validatedRun({ finishReason: "stop" })])
    expect(summary.toolCallsMatchRate).toBeUndefined()
    expect(summary.toolCallsSchemaAccuracy).toBeUndefined()
  })
})

// ── A5: always-on error-only-reasoning check ───────────────────────────────

describe("error-only-reasoning check", () => {
  it("flags reasoning with empty content AND empty tool calls", () => {
    expect(
      isErrorOnlyReasoning({ reasoningContent: "thinking...", content: null, toolCalls: null }),
    ).toBe(true)
    expect(
      isErrorOnlyReasoning({ reasoningContent: "thinking...", content: "", toolCalls: [] }),
    ).toBe(true)
    expect(
      isErrorOnlyReasoning({
        reasoningContent: "thinking...",
        content: undefined,
        toolCalls: undefined,
      }),
    ).toBe(true)
  })

  it("does not flag when any channel carries output", () => {
    expect(
      isErrorOnlyReasoning({ reasoningContent: "thinking...", content: "answer", toolCalls: null }),
    ).toBe(false)
    expect(
      isErrorOnlyReasoning({
        reasoningContent: "thinking...",
        content: null,
        toolCalls: [{ function: { name: "search" } }],
      }),
    ).toBe(false)
    expect(
      isErrorOnlyReasoning({ reasoningContent: null, content: "answer", toolCalls: null }),
    ).toBe(false)
    expect(isErrorOnlyReasoning(undefined)).toBe(false)
  })

  it("treats non-array truthy tool_calls as present (provider-shape compat)", () => {
    expect(
      isErrorOnlyReasoning({
        reasoningContent: "thinking...",
        content: null,
        toolCalls: [{ function: { name: "search" } }] as never,
      }),
    ).toBe(false)
  })

  it("marks every run checked and aggregates the rate", () => {
    const flagged = runErrorOnlyReasoningCheck({
      reasoningContent: "hmm",
      content: null,
      toolCalls: null,
    })
    expect(flagged).toEqual({ errorOnlyReasoningChecked: true, errorOnlyReasoning: true })
    const clean = runErrorOnlyReasoningCheck({
      reasoningContent: null,
      content: "hi",
      toolCalls: null,
    })
    const runs: ValidatorCaseRun[] = [
      { ctx: fakeCase("1"), fields: flagged as unknown as Record<string, unknown> },
      { ctx: fakeCase("2"), fields: clean as unknown as Record<string, unknown> },
    ]
    expect(summarizeErrorOnlyReasoning(runs)).toEqual({
      errorOnlyReasoningCheckedCount: 2,
      errorOnlyReasoningCount: 1,
      errorOnlyReasoningRate: 0.5,
    })
  })

  it("runs on every baseline result and aggregates into the suite metrics", async () => {
    const provider: Provider = {
      id: "mock",
      name: "mock",
      defaultModel: "mock-1",
      isConfigured: () => true,
      chat: async (): Promise<ChatResponse> => ({
        content: "",
        model: "mock-1",
        finishReason: "stop",
        raw: {
          choices: [{ message: { content: null, reasoning_content: "long thinking only" } }],
        },
      }),
      stream: async function* () {
        yield { delta: "", done: true }
      },
    }
    const evaluator = new BenchmarkEvaluator({
      provider,
      dags: { compose: async () => ({}) } as never,
      validators: [],
    })
    const task: BenchmarkTask = {
      id: "t-reasoning",
      domain: "database",
      difficulty: "easy",
      input: "q",
      context: { ddl: "CREATE TABLE t(x INTEGER);", goldQuery: "SELECT * FROM t", goldResult: [] },
      expectedOutputAssertion: async () => true,
    }
    const result = await evaluator.evaluateOne(task)
    expect(result.errorOnlyReasoningChecked).toBe(true)
    expect(result.errorOnlyReasoning).toBe(true)

    const agg = computeAggregate([result])
    expect(agg.errorOnlyReasoningCheckedCount).toBe(1)
    expect(agg.errorOnlyReasoningCount).toBe(1)
    expect(agg.errorOnlyReasoningRate).toBe(1)
  })

  it("does not hoist error-only fields for legacy results without the check", () => {
    const legacy: BenchmarkResult = {
      taskId: "old",
      passed: true,
      quality: 1,
      latencyMs: 10,
      tokenUsage: { prompt: 0, completion: 0, total: 0 },
      acceptanceScore: 1,
      output: "x",
    }
    const agg = computeAggregate([legacy])
    expect(agg.errorOnlyReasoningCheckedCount).toBeUndefined()
    expect(agg.errorOnlyReasoningRate).toBeUndefined()
  })
})

// ── A6: scenario key-order probe ───────────────────────────────────────────

describe("ScenarioCheckValidator (key-order recall probe)", () => {
  const validator = new ScenarioCheckValidator()
  const tools = [
    {
      type: "function",
      function: {
        name: "book_flight",
        parameters: {
          type: "object",
          properties: {
            departure: { type: "string" },
            destination: { type: "string" },
            date: { type: "string" },
          },
        },
      },
    },
  ]

  it("passes when the reply preserves the definition's key order", () => {
    const fields = validator.validate(
      fakeCase("t", {
        tools,
        output: "I will book from departure to destination on date.",
      }),
    )
    expect(fields.scenarioCheckChecked).toBe(true)
    expect(fields.scenarioCheckValid).toBe(true)
    expect(fields.scenarioCheckDetail).toEqual({
      expected: ["departure", "destination", "date"],
      actual: ["departure", "destination", "date"],
    })
  })

  it("fails when the reply reorders the keys", () => {
    const fields = validator.validate(
      fakeCase("t", { tools, output: "date then destination then departure." }),
    )
    expect(fields.scenarioCheckChecked).toBe(true)
    expect(fields.scenarioCheckValid).toBe(false)
  })

  it("strips <think> blocks before reading the order", () => {
    const fields = validator.validate(
      fakeCase("t", {
        tools,
        output:
          "<think>let me weigh date against destination first... destination date departure is fine too</think>From departure to destination on date.",
      }),
    )
    expect(fields.scenarioCheckValid).toBe(true)
  })

  it("does not judge a single-parameter probe (< 2 params)", () => {
    const single = [
      {
        type: "function",
        function: {
          name: "ping",
          parameters: { type: "object", properties: { host: { type: "string" } } },
        },
      },
    ]
    const fields = validator.validate(fakeCase("t", { tools: single, output: "ping the host" }))
    expect(fields.scenarioCheckChecked).toBe(true)
    // One key has no order to preserve → cannot be judged valid.
    expect(fields.scenarioCheckValid).toBe(false)
  })

  it("skips failed requests and cases without tools", () => {
    expect(
      validator.validate(fakeCase("t", { status: "failed", tools, output: "x" }))
        .scenarioCheckChecked,
    ).toBe(false)
    expect(validator.validate(fakeCase("t", { output: "x" })).scenarioCheckChecked).toBe(false)
    expect(validator.validate(fakeCase("t", { tools, output: "" })).scenarioCheckChecked).toBe(
      false,
    )
  })

  it("aggregates checked/valid/invalid with a pass rate", () => {
    const pass = validator.validate(fakeCase("t", { tools, output: "departure destination date" }))
    const fail = validator.validate(fakeCase("t", { tools, output: "date destination departure" }))
    const runs: ValidatorCaseRun[] = [
      { ctx: fakeCase("1"), fields: pass as unknown as Record<string, unknown> },
      { ctx: fakeCase("2"), fields: fail as unknown as Record<string, unknown> },
    ]
    const summary = validator.computeSummary(runs)
    expect(summary.scenarioCheckCheckedCount).toBe(2)
    expect(summary.scenarioCheckValidCount).toBe(1)
    expect(summary.scenarioCheckInvalidCount).toBe(1)
    expect(summary.scenarioCheckPassRate).toBe(0.5)
  })
})
