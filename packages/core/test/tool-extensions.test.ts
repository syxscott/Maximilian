// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Tests for the two tool-loop extensions (minimax-code borrowing):
 * runaway-guard (onStepEnd) and tool-output-budget (afterToolCall).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { promises as fs } from "node:fs"
import path from "node:path"
import os from "node:os"
import { createRunawayGuard, createToolOutputBudget } from "../src/tool-extensions.js"
import { runToolLoop, ToolEnabledProvider, createToolRegistry } from "../src/tool-integration.js"
import type { AfterToolCallContext } from "../src/types.js"
import type { Provider, ChatMessage, ChatResponse } from "@max/providers"

describe("createRunawayGuard", () => {
  it("stays silent while tool calls progress", () => {
    const guard = createRunawayGuard({ patience: 2 })
    expect(guard.onStepEnd(0, { toolCalls: 2 })).toBeUndefined()
    expect(guard.onStepEnd(1, { toolCalls: 1 })).toBeUndefined()
    expect(guard.onStepEnd(2, { toolCalls: 0 })).toBeUndefined() // first no-progress step
    expect(guard.state.consecutiveNoProgress).toBe(1)
  })

  it("fires a one-shot reminder after N consecutive no-progress steps", () => {
    const guard = createRunawayGuard({ patience: 2 })
    guard.onStepEnd(0, { toolCalls: 0 }) // count 1
    const reminder = guard.onStepEnd(1, { toolCalls: 0 }) // count 2 ≥ patience → fires
    expect(reminder).toContain("[strategy reminder]")
    // One-shot: no repeat nagging.
    expect(guard.onStepEnd(2, { toolCalls: 0 })).toBeUndefined()
  })

  it("shadow mode tracks state but never emits", () => {
    const guard = createRunawayGuard({ patience: 1, shadow: true })
    guard.onStepEnd(0, { toolCalls: 0 })
    expect(guard.onStepEnd(1, { toolCalls: 0 })).toBeUndefined()
    expect(guard.state.fired).toBe(true)
  })
})

// ── tool output budget ───────────────────────────────────────────────────────

function providerIssuing(toolName: string, input: Record<string, unknown>): Provider {
  let calls = 0
  return {
    id: "stub",
    name: "Stub",
    defaultModel: "stub-1",
    isConfigured: () => true,
    async chat(): Promise<ChatResponse> {
      calls += 1
      if (calls === 1) {
        return {
          content: `\`\`\`tool\n${JSON.stringify({ name: toolName, input })}\n\`\`\``,
          model: "stub-1",
          usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 },
        }
      }
      return {
        content: "done",
        model: "stub-1",
        usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 },
      }
    },

    async *stream(): AsyncIterable<never> {
      throw new Error("not used")
    },
  }
}

describe("createToolOutputBudget (integrated through runToolLoop)", () => {
  let dir: string
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "outbudget-"))
  })
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it("externalizes oversized tool output to an artifact and receipts", async () => {
    const registry = createToolRegistry()
    registry.register({
      producer: {
        name: "producer",
        kind: "misc",
        description: "produces big output",
        inputSchema: { type: "object" },
        async execute() {
          return {
            result: "y".repeat(50_000),
            output: {
              structured: { blob: "y".repeat(50_000) },
              content: [{ type: "text", text: "big" }],
            },
          }
        },
      } as never,
    })
    const budget = createToolOutputBudget({ artifactDir: dir, maxChars: 1000 })
    const provider = new ToolEnabledProvider(providerIssuing("producer", {}), registry)
    const { allToolCalls } = await runToolLoop(provider, [{ role: "user", content: "go" }], {
      maxRounds: 2,
      afterToolCall: budget.afterToolCall,
    })
    expect(allToolCalls).toHaveLength(1)
    const files = await fs.readdir(dir)
    expect(files).toHaveLength(1)
    const artifact = await fs.readFile(path.join(dir, files[0]!), "utf8")
    // The artifact holds the FULL stringified result (wrapper included) —
    // at least the raw blob, not the budgeted receipt.
    expect(artifact.length).toBeGreaterThanOrEqual(50_000)
    expect(artifact).toContain("yyyy")
  })

  it("leaves small outputs untouched", async () => {
    const registry = createToolRegistry()
    registry.register({
      producer: {
        name: "producer",
        kind: "misc",
        description: "small",
        inputSchema: { type: "object" },
        async execute() {
          return {
            result: "tiny",
            output: { structured: "tiny", content: [{ type: "text", text: "tiny" }] },
          }
        },
      } as never,
    })
    const budget = createToolOutputBudget({ artifactDir: dir, maxChars: 1000 })
    const provider = new ToolEnabledProvider(providerIssuing("producer", {}), registry)
    const { response } = await runToolLoop(provider, [{ role: "user", content: "go" }], {
      maxRounds: 2,
      afterToolCall: budget.afterToolCall,
    })
    expect(response.content).toBe("done")
    const files = await fs.readdir(dir)
    expect(files).toHaveLength(0)
  })
})

// ── Secret scrubbing (hermes-agent "mask before cutting") ────────────────────

describe("createToolOutputBudget secret scrubbing", () => {
  const SECRET = "Z".repeat(600)
  // Structural vault stand-in: proves the exact-match layer is wired through.
  const vault = { redact: (text: string): string => text.split(SECRET).join("[redacted]") }

  function ctxWith(result: unknown): AfterToolCallContext {
    return {
      assistantMessage: {},
      toolCall: { name: "producer" },
      args: {},
      result,
      isError: false,
      context: {},
    }
  }

  function textOf(result: { content?: unknown } | undefined): string {
    const block = result?.content
    if (Array.isArray(block) && block[0] && typeof block[0].text === "string") {
      return block[0].text
    }
    return ""
  }

  it("scrubs the externalized artifact before persisting it", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "outbudget-scrub-"))
    try {
      const budget = createToolOutputBudget({ artifactDir: dir, maxChars: 100, vault })
      // Filler keeps the scrubbed text over budget: redacting a 600-char
      // secret must not by itself flip the output into the "small" path.
      const out = await budget.afterToolCall(
        ctxWith({ output: `${"A".repeat(500)}${SECRET}${"B".repeat(500)}` }),
      )
      expect(out).toBeDefined()
      const files = await fs.readdir(dir)
      expect(files).toHaveLength(1)
      const artifact = await fs.readFile(path.join(dir, files[0]!), "utf8")
      expect(artifact).not.toContain(SECRET)
      expect(artifact).toContain("[redacted]")
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it("head+tail fallback preview has no credential prefix when the window starts inside it", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "outbudget-preview-"))
    try {
      // Block artifact creation with a regular file so the write fails and
      // the head+tail preview path runs.
      const blocker = path.join(dir, "blocker")
      await fs.writeFile(blocker, "x")
      const budget = createToolOutputBudget({
        artifactDir: blocker,
        maxChars: 1000,
        vault,
      })
      // tail window starts at len-1000 = 2500+600-1000, inside SECRET.
      const text = `${"A".repeat(1900)}${SECRET}${"B".repeat(500)}`
      const out = await budget.afterToolCall(ctxWith({ output: text }))
      const preview = textOf(out)
      expect(preview).toContain("[output truncated")
      expect(preview).toContain("[redacted]")
      expect(preview).not.toContain("ZZZZZ")
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it("leaves small, secret-free outputs untouched", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "outbudget-plain-"))
    try {
      const budget = createToolOutputBudget({ artifactDir: dir, maxChars: 1000, vault })
      const out = await budget.afterToolCall(ctxWith({ output: "tiny output" }))
      expect(out).toBeUndefined()
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})
