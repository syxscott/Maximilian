// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Warn-once outage tests.
 *
 * Covers the OpenAgentCore exporter.go mechanism ported to telemetry:
 *   - OTLP export wrapper: N consecutive failures warn once, a success logs
 *     an explicit recovery, and a later failure warns again.
 *   - Raw exporter error bodies never reach the recorded sink.
 *   - Outcome classes: timeout / panic / error.
 *   - TelemetryCollector JSONL persistence follows the same semantics.
 */

import { describe, it, expect, afterEach, vi } from "vitest"
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  WarnOnceSpanExporter,
  EXPORT_RESULT_FAILED,
  EXPORT_RESULT_SUCCESS,
  type SpanExportCallback,
  type SpanExporterLike,
} from "../src/otelExporter.js"
import { classifyFailure, type FailureOutcome, type OutageSink } from "../src/outage.js"
import { TelemetryCollector } from "../src/collector.js"

// ── Helpers ──────────────────────────────────────────────────────────────────

interface SinkRecord {
  warnings: { scope: string; outcome: FailureOutcome }[]
  recovered: string[]
}

function makeSink(): { record: SinkRecord; sink: OutageSink } {
  const record: SinkRecord = { warnings: [], recovered: [] }
  const sink: OutageSink = {
    warn(scope, outcome) {
      record.warnings.push({ scope, outcome })
    },
    recovered(scope) {
      record.recovered.push(scope)
    },
  }
  return { record, sink }
}

type FakeStep = "ok" | "error" | "timeout" | "panic" | "hang"

/** Scriptable span exporter: each export() consumes the next scripted step. */
class FakeExporter implements SpanExporterLike {
  private calls = 0
  shutdownCalls = 0
  forceFlushCalls = 0

  constructor(private readonly script: FakeStep[]) {}

  export(_spans: readonly unknown[], resultCallback: SpanExportCallback): void {
    const step = this.script[this.calls] ?? "ok"
    this.calls += 1
    switch (step) {
      case "ok":
        resultCallback({ code: EXPORT_RESULT_SUCCESS })
        break
      case "error":
        // Simulates a collector response body that must never be logged.
        resultCallback({
          code: EXPORT_RESULT_FAILED,
          error: new Error("collector response body SECRET"),
        })
        break
      case "timeout": {
        const err = new Error("socket hangup")
        err.name = "TimeoutError"
        resultCallback({ code: EXPORT_RESULT_FAILED, error: err })
        break
      }
      case "panic":
        throw new Error("unexpected synchronous failure")
      case "hang":
        break
    }
  }

  async shutdown(): Promise<void> {
    this.shutdownCalls += 1
  }

  async forceFlush(): Promise<void> {
    this.forceFlushCalls += 1
  }
}

function makeExecutionInput(taskId: string) {
  return {
    workspaceId: "ws-1",
    taskId,
    userPrompt: "Build a REST API",
    assignedTeamGraph: {
      id: "graph-1",
      nodes: [{ id: "n1", role: "backend", displayName: "Backend Agent", dependsOn: [] }],
      capabilities: ["backend"],
    },
    steps: [],
    status: "running" as const,
  }
}

// ── OTLP exporter wrapper ────────────────────────────────────────────────────

describe("WarnOnceSpanExporter — warn-once per outage", () => {
  it("warns once across N failures, logs recovery, then warns on the next outage", () => {
    const fake = new FakeExporter(["error", "error", "error", "ok", "error"])
    const sinkRecord = makeSink()
    const exporter = new WarnOnceSpanExporter(fake, sinkRecord.sink)

    const codes: number[] = []
    for (let i = 0; i < 5; i++) {
      exporter.export([], (result) => codes.push(result.code))
    }

    // Exactly two outages -> exactly two warnings; one recovery in between.
    expect(sinkRecord.record.warnings).toEqual([
      { scope: "otlp trace export", outcome: "error" },
      { scope: "otlp trace export", outcome: "error" },
    ])
    expect(sinkRecord.record.recovered).toEqual(["otlp trace export"])

    // Underlying exporter results are still propagated untouched.
    expect(codes).toEqual([
      EXPORT_RESULT_FAILED,
      EXPORT_RESULT_FAILED,
      EXPORT_RESULT_FAILED,
      EXPORT_RESULT_SUCCESS,
      EXPORT_RESULT_FAILED,
    ])
  })

  it("never records the raw exporter error body", () => {
    const fake = new FakeExporter(["error"])
    const sinkRecord = makeSink()
    const exporter = new WarnOnceSpanExporter(fake, sinkRecord.sink)

    exporter.export([], () => {})

    const logged = JSON.stringify(sinkRecord.record)
    expect(logged).not.toContain("SECRET")
    expect(logged).not.toContain("collector response body")
  })

  it("classifies timeout outcomes distinctly within one outage", () => {
    const fake = new FakeExporter(["timeout", "panic", "ok", "error"])
    const sinkRecord = makeSink()
    const exporter = new WarnOnceSpanExporter(fake, sinkRecord.sink)

    for (let i = 0; i < 4; i++) exporter.export([], () => {})

    // First failure warns; panic is suppressed as part of the same outage;
    // success recovers; the later error opens a second outage.
    expect(sinkRecord.record.warnings).toEqual([
      { scope: "otlp trace export", outcome: "timeout" },
      { scope: "otlp trace export", outcome: "error" },
    ])
    expect(sinkRecord.record.recovered).toEqual(["otlp trace export"])
  })

  it("reports a hung exporter as timeout instead of warning forever", async () => {
    vi.useFakeTimers()
    try {
      const fake = new FakeExporter(["hang"])
      const sinkRecord = makeSink()
      const exporter = new WarnOnceSpanExporter(fake, sinkRecord.sink)

      exporter.export([], () => {})
      await vi.advanceTimersByTimeAsync(2_000)

      expect(sinkRecord.record.warnings).toEqual([
        { scope: "otlp trace export", outcome: "timeout" },
      ])
    } finally {
      vi.useRealTimers()
    }
  })

  it("forwards shutdown and forceFlush to the inner exporter", async () => {
    const fake = new FakeExporter([])
    const exporter = new WarnOnceSpanExporter(fake, makeSink().sink)

    await exporter.shutdown()
    await exporter.forceFlush()

    expect(fake.shutdownCalls).toBe(1)
    expect(fake.forceFlushCalls).toBe(1)
  })
})

describe("classifyFailure", () => {
  it("maps timeout-like errors to timeout", () => {
    const named = new Error("x")
    named.name = "TimeoutError"
    expect(classifyFailure(named)).toBe("timeout")

    const errno = Object.assign(new Error("x"), { code: "ETIMEDOUT" })
    expect(classifyFailure(errno)).toBe("timeout")
  })

  it("maps everything else to error without retaining it", () => {
    expect(classifyFailure(new Error("boom"))).toBe("error")
    expect(classifyFailure("not an error")).toBe("error")
  })
})

// ── TelemetryCollector persistence ───────────────────────────────────────────

describe("TelemetryCollector — persist warn-once", () => {
  let tmpDir: string

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
  })

  it("warns once per disk outage and logs recovery without raw error details", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "telemetry-warnonce-"))
    const gate = join(tmpDir, "gate")
    const persistPath = join(gate, "data")

    // Block the persist path with a regular file so mkdir fails on Linux/macOS.
    writeFileSync(gate, "not a directory")

    const sinkRecord = makeSink()
    const collector = new TelemetryCollector(
      { persistPath, maxBufferSize: 10 },
      undefined,
      sinkRecord.sink,
    )

    for (let i = 0; i < 3; i++) {
      await collector.recordExecution(makeExecutionInput(`outage-${i}`))
    }
    await collector.flush()

    expect(sinkRecord.record.warnings).toEqual([{ scope: "persist execution", outcome: "error" }])
    expect(sinkRecord.record.recovered).toEqual([])

    // Recover: unblock the path and persist successfully.
    rmSync(gate, { force: true })
    await collector.recordExecution(makeExecutionInput("recovered"))
    await collector.flush()

    expect(sinkRecord.record.recovered).toEqual(["persist execution"])
    expect(sinkRecord.record.warnings).toHaveLength(1)
    expect(
      readFileSync(join(persistPath, "executions.jsonl"), "utf-8").trim().split("\n"),
    ).toHaveLength(1)

    // Second outage: re-block the path and fail twice more.
    rmSync(gate, { recursive: true, force: true })
    writeFileSync(gate, "not a directory")

    await collector.recordExecution(makeExecutionInput("outage-again-1"))
    await collector.recordExecution(makeExecutionInput("outage-again-2"))
    await collector.flush()

    expect(sinkRecord.record.warnings).toEqual([
      { scope: "persist execution", outcome: "error" },
      { scope: "persist execution", outcome: "error" },
    ])
    expect(sinkRecord.record.recovered).toEqual(["persist execution"])

    // The sink never sees filesystem error codes/paths.
    const logged = JSON.stringify(sinkRecord.record)
    expect(logged).not.toContain("ENOTDIR")
    expect(logged).not.toContain(tmpDir)
  })
})
