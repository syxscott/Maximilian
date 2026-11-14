// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Incremental rerun tests (borrowing MiniMax-Provider-Verifier
 * verify.py:27-30,432-477): successful cases are skipped by stable
 * request hash, failed/new cases rerun, results merge back sorted by
 * data_index, and the summary is recomputed. Without a persistPath the
 * evaluator sends every case (behaviour unchanged).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { promises as fs } from "node:fs"
import path from "node:path"
import os from "node:os"

import { BenchmarkEvaluator } from "../src/evaluator.js"
import { loadPersistedResults } from "../src/persistence.js"
import type { BenchmarkTask } from "../src/types.js"
import type { Provider, ChatMessage, ChatResponse } from "@max/providers"

function makeTask(id: string, input: string): BenchmarkTask {
  return {
    id,
    domain: "database",
    difficulty: "easy",
    input,
    context: {
      ddl: "CREATE TABLE t(x INTEGER); INSERT INTO t VALUES (1);",
      goldQuery: "SELECT * FROM t",
      goldResult: [{ x: 1 }],
    },
    expectedOutputAssertion: async (output) => /SELECT/i.test(output),
  }
}

/** Provider that routes on the task input and stamps each reply with a run id. */
function makeProvider(routes: Record<string, string>, log: string[]): Provider {
  return {
    id: "mock",
    name: "mock",
    defaultModel: "mock-1",
    isConfigured: () => true,
    chat: async (messages: ChatMessage[]): Promise<ChatResponse> => {
      const user = messages.find((m) => m.role === "user")?.content ?? ""
      log.push(user.split("\n")[0] ?? "")
      const key = Object.keys(routes).find((k) => user.startsWith(k)) ?? ""
      return { content: routes[key] ?? "", model: "mock-1" }
    },
    stream: async function* () {
      yield { delta: "ok", done: true }
    },
  }
}

describe("incremental rerun", () => {
  let tmp: string
  let persistPath: string

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "max-bench-incr-"))
    persistPath = path.join(tmp, "results.jsonl")
  })
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true })
  })

  it("round 1 sends all 3 cases (1 fails); round 2 sends only the failed + changed case", async () => {
    const tasks = [
      makeTask("t1", "list rows"),
      makeTask("t2", "broken query"),
      makeTask("t3", "count rows"),
    ]

    // Round 1: t2's route produces no SQL → quality 0, error set.
    const round1Log: string[] = []
    const round1Provider = makeProvider(
      {
        "list rows": "```sql\nSELECT * FROM t; -- round-1\n```",
        "broken query": "I cannot write SQL.",
        "count rows": "```sql\nSELECT * FROM t; -- round-1\n```",
      },
      round1Log,
    )
    const evaluator1 = new BenchmarkEvaluator({
      provider: round1Provider,
      dags: { compose: async () => ({}) } as never,
      persistPath,
      validators: [],
    })
    const suite1 = await evaluator1.evaluate(tasks)
    expect(round1Log).toEqual(["list rows", "broken query", "count rows"])
    expect(suite1.results.map((r) => r.passed)).toEqual([true, false, true])
    expect(suite1.results.map((r) => r.dataIndex)).toEqual([0, 1, 2])
    expect(suite1.skippedByHash).toBeUndefined()

    const persisted = await loadPersistedResults(persistPath)
    expect(persisted).toHaveLength(3)
    expect(persisted.every((r) => typeof r.hash === "string")).toBe(true)

    // Round 2: t3's input changed (new hash), t2 failed last round → both
    // rerun; t1 is successful and skipped by hash. Exactly 2 sends.
    const round2Log: string[] = []
    const round2Provider = makeProvider(
      {
        "broken query": "I cannot write SQL.",
        "changed count": "```sql\nSELECT * FROM t; -- round-2\n```",
      },
      round2Log,
    )
    const evaluator2 = new BenchmarkEvaluator({
      provider: round2Provider,
      dags: { compose: async () => ({}) } as never,
      persistPath,
      validators: [],
    })
    const round2Tasks = [tasks[0]!, tasks[1]!, makeTask("t3", "changed count")]
    const suite2 = await evaluator2.evaluate(round2Tasks)

    expect(round2Log).toEqual(["broken query", "changed count"])
    expect(suite2.skippedByHash).toBe(1)

    // Results sorted by data_index in task order, all present.
    expect(suite2.results.map((r) => r.taskId)).toEqual(["t1", "t2", "t3"])
    expect(suite2.results.map((r) => r.dataIndex)).toEqual([0, 1, 2])

    // The skipped success kept its round-1 output (hash-preserved), the
    // rerun cases carry the round-2 stamp.
    expect(suite2.results[0]!.output).toContain("round-1")
    expect(suite2.results[2]!.output).toContain("round-2")

    // File rewritten with the merged, sorted results.
    const rewritten = await loadPersistedResults(persistPath)
    expect(rewritten.map((r) => r.taskId)).toEqual(["t1", "t2", "t3"])

    // Summary recomputed over the merged results (t1 + t3 passed, t2
    // failed); passRate is rounded to 2 decimals by computeAggregate.
    expect(suite2.aggregateMetrics.passRate).toBeCloseTo(0.67, 2)
  })

  it("without persistPath every case is sent (behaviour unchanged)", async () => {
    const log: string[] = []
    const provider = makeProvider({ t: "```sql\nSELECT * FROM t; -- x\n```" }, log)
    const evaluator = new BenchmarkEvaluator({
      provider,
      dags: { compose: async () => ({}) } as never,
      validators: [],
    })
    const tasks = [makeTask("t1", "t"), makeTask("t2", "t")]
    await evaluator.evaluate(tasks)
    expect(log).toHaveLength(2)
  })

  it("a failed case reruns even when its hash did not change", async () => {
    const tasks = [makeTask("t1", "same input"), makeTask("t2", "other input")]

    const failingProvider = makeProvider({ t: "I cannot write SQL." }, [])
    const evaluator1 = new BenchmarkEvaluator({
      provider: failingProvider,
      dags: { compose: async () => ({}) } as never,
      persistPath,
      validators: [],
    })
    await evaluator1.evaluate(tasks)

    // Round 2: unchanged inputs, but t2 now succeeds → t2 reruns while t1
    // (still failing) reruns too; nothing is skipped.
    const log2: string[] = []
    const recoveringProvider = makeProvider({ t: "```sql\nSELECT * FROM t;\n```" }, log2)
    const evaluator2 = new BenchmarkEvaluator({
      provider: recoveringProvider,
      dags: { compose: async () => ({}) } as never,
      persistPath,
      validators: [],
    })
    const suite2 = await evaluator2.evaluate(tasks)
    expect(log2).toEqual(["same input", "other input"])
    expect(suite2.skippedByHash).toBeUndefined()
  })
})
