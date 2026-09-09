// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Tests for tool-stream.ts
 * Validates streaming tool protocol, progress/terminal items, and stream helpers.
 */

import { describe, it, expect } from "vitest"
import {
  progress,
  progressText,
  progressStdout,
  progressStderr,
  progressJson,
  progressNotification,
  terminalSuccess,
  terminalError,
  isProgress,
  isTerminal,
  fromPromise,
  streamToToolOutput,
  type ToolStreamItem,
} from "../src/tool-stream.js"

describe("progress factories", () => {
  it("creates a basic progress item", () => {
    const item = progressText("Hello")
    expect(item.type).toBe("progress")
    expect(item.content).toEqual({ kind: "text", text: "Hello" })
    expect(item.timestamp).toBeDefined()
  })

  it("creates stdout progress", () => {
    const item = progressStdout("line1\nline2")
    expect(item.type).toBe("progress")
    expect(item.content).toEqual({ kind: "stdout", data: "line1\nline2" })
  })

  it("creates stderr progress", () => {
    const item = progressStderr("error message")
    expect(item.type).toBe("progress")
    expect(item.content).toEqual({ kind: "stderr", data: "error message" })
  })

  it("creates json progress", () => {
    const item = progressJson({ key: "value" })
    expect(item.type).toBe("progress")
    expect(item.content).toEqual({ kind: "json", data: { key: "value" } })
  })

  it("creates notification progress (info)", () => {
    const item = progressNotification("Task started")
    expect(item.type).toBe("progress")
    expect(item.content).toEqual({ kind: "notification", message: "Task started", level: "info" })
  })

  it("creates notification progress (warn)", () => {
    const item = progressNotification("Warning!", "warn")
    expect(item.type).toBe("progress")
    expect(item.content).toEqual({ kind: "notification", message: "Warning!", level: "warn" })
  })

  it("creates notification progress (error)", () => {
    const item = progressNotification("Error occurred", "error")
    expect(item.type).toBe("progress")
    expect(item.content).toEqual({ kind: "notification", message: "Error occurred", level: "error" })
  })

  it("progress accepts custom timestamp", () => {
    const ts = 1234567890000
    const item = progress({ kind: "text", text: "test" }, ts)
    expect(item.timestamp).toBe(ts)
  })
})

describe("terminal factories", () => {
  it("creates success terminal", () => {
    const item = terminalSuccess({ result: "ok" }, 100)
    expect(item.type).toBe("terminal")
    expect(item.ok).toBe(true)
    expect(item.result).toEqual({ result: "ok" })
    expect(item.durationMs).toBe(100)
    expect(item.error).toBeUndefined()
  })

  it("creates error terminal", () => {
    const item = terminalError("Something went wrong", 50)
    expect(item.type).toBe("terminal")
    expect(item.ok).toBe(false)
    expect(item.error).toBe("Something went wrong")
    expect(item.durationMs).toBe(50)
    expect(item.result).toBeUndefined()
  })
})

describe("type guards", () => {
  it("isProgress returns true for progress items", () => {
    const item = progressText("test")
    expect(isProgress(item)).toBe(true)
    expect(isTerminal(item)).toBe(false)
  })

  it("isTerminal returns true for terminal items", () => {
    const item = terminalSuccess("done", 100)
    expect(isProgress(item)).toBe(false)
    expect(isTerminal(item)).toBe(true)
  })
})

describe("fromPromise", () => {
  it("yields terminal success when promise resolves", async () => {
    const promise = Promise.resolve({ value: 42 })
    const items: ToolStreamItem<unknown>[] = []

    for await (const item of fromPromise(promise)) {
      items.push(item)
    }

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      type: "terminal",
      ok: true,
      result: { value: 42 },
    })
  })

  it("yields terminal error when promise rejects", async () => {
    const promise = Promise.reject(new Error("failed"))
    const items: ToolStreamItem<unknown>[] = []

    // Suppress console error from unhandled rejection
    try {
      for await (const item of fromPromise(promise)) {
        items.push(item)
      }
    } catch {
      // Expected
    }

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      type: "terminal",
      ok: false,
    })
  })
})

describe("streamToToolOutput", () => {
  it("converts progress items to content", () => {
    const items: ToolStreamItem<unknown>[] = [
      progressText("Step 1"),
      progressStdout("output line"),
      terminalSuccess({ done: true }, 100),
    ]

    const toolOutput = streamToToolOutput(items)

    expect(toolOutput.structured).toEqual({ done: true })
    expect(toolOutput.content).toContainEqual({ type: "text", text: "Step 1" })
    expect(toolOutput.content).toContainEqual({ type: "text", text: "output line" })
  })

  it("handles error terminal", () => {
    const items: ToolStreamItem<unknown>[] = [
      progressText("Error occurred"),
      terminalError("Something broke", 50),
    ]

    const toolOutput = streamToToolOutput(items)

    expect(toolOutput.structured).toEqual({ error: "Something broke" })
  })

  it("handles empty stream", () => {
    const toolOutput = streamToToolOutput<unknown>([])

    expect(toolOutput.structured).toEqual({ error: "unknown" })
    expect(toolOutput.content).toHaveLength(0)
  })

  it("handles progress with json content", () => {
    const items: ToolStreamItem<unknown>[] = [
      progressJson({ status: "running", percent: 50 }),
      terminalSuccess("complete", 200),
    ]

    const toolOutput = streamToToolOutput(items)

    expect(toolOutput.content).toContainEqual({
      type: "text",
      text: '{"status":"running","percent":50}',
    })
  })

  it("handles stderr progress", () => {
    const items: ToolStreamItem<unknown>[] = [
      progressStderr("error message"),
      terminalSuccess("done", 100),
    ]

    const toolOutput = streamToToolOutput(items)

    expect(toolOutput.content).toContainEqual({
      type: "text",
      text: "[stderr] error message",
    })
  })
})

describe("streaming invariant", () => {
  it("allows zero or more progress items before terminal", async () => {
    // Zero progress items
    const items1: ToolStreamItem<string>[] = [terminalSuccess("done", 100)]
    expect(isTerminal(items1[items1.length - 1])).toBe(true)

    // Multiple progress items
    const items2: ToolStreamItem<string>[] = [
      progressText("start"),
      progressText("step 1"),
      progressText("step 2"),
      terminalSuccess("done", 100),
    ]
    for (let i = 0; i < items2.length - 1; i++) {
      expect(isProgress(items2[i])).toBe(true)
    }
    expect(isTerminal(items2[items2.length - 1])).toBe(true)
  })

  it("terminal item contains final result or error", () => {
    const success = terminalSuccess({ key: "value" }, 100)
    expect(success.ok).toBe(true)
    expect(success.result).toBeDefined()

    const error = terminalError("failed", 50)
    expect(error.ok).toBe(false)
    expect(error.error).toBeDefined()
  })
})

describe("timestamp", () => {
  it("progress items have timestamp", () => {
    const before = Date.now()
    const item = progressText("test")
    const after = Date.now()

    expect(item.timestamp).toBeGreaterThanOrEqual(before)
    expect(item.timestamp).toBeLessThanOrEqual(after)
  })

  it("terminal items have durationMs", () => {
    const item = terminalSuccess("result", 150)
    expect(item.durationMs).toBe(150)
  })
})
