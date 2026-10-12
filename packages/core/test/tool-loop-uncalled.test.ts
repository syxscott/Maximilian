// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT

/**
 * Uncalled tool-call settlement (opencode c9e1ed7080 failUnsettledTools
 * "uncalled" borrowing): calls announced by the model but never executed —
 * budget truncation, mid-round budget exhaustion — are settled with the
 * structured INPUT_INCOMPLETE error instead of dangling unanswered into the
 * next round's context.
 */
import { describe, expect, it } from "vitest"
import { makeTool } from "@max/llm"
import {
  ToolEnabledProvider,
  createToolRegistry,
  runToolLoop,
  UNCALLED_TOOL_CALL_ERROR,
} from "../src/tool-integration.js"
import type { ChatResponse, Provider } from "@max/providers"
import type { RuntimeEvent } from "../src/types.js"

const toolBlock = (name: string, input: unknown): string =>
  "```tool\n" + JSON.stringify({ name, input }) + "\n```"

const responseWithCalls = (...names: string[]): ChatResponse => ({
  content: names.map((n) => toolBlock(n, { x: 1 })).join("\n"),
  model: "scripted-1",
  usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
})

const plain = (content: string): ChatResponse => ({
  content,
  model: "scripted-1",
  usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
})

class ScriptedProvider implements Provider {
  id = "scripted"
  name = "scripted"
  defaultModel = "scripted-1"
  isConfigured(): boolean {
    return true
  }
  readonly requests: string[][] = []
  private step = 0
  constructor(private readonly script: ChatResponse[]) {}
  async chat(messages: { content: string }[]): Promise<ChatResponse> {
    this.requests.push(messages.map((m) => m.content))
    return this.script[Math.min(this.step++, this.script.length - 1)]!
  }
  async *stream(): AsyncIterable<never> {
    throw new Error("not used")
  }
}

const makeLoop = (provider: Provider): ToolEnabledProvider => {
  const registry = createToolRegistry()
  registry.register({
    echo: makeTool({
      name: "echo",
      description: "echo",
      kind: "misc",
      inputSchema: { type: "object" },
      execute: async (input) => input,
    }),
  })
  return new ToolEnabledProvider(provider, registry)
}

describe("runToolLoop settles uncalled tool calls", () => {
  it("mid-round budget exhaustion produces a structured error result, not a dangling call", async () => {
    const provider = new ScriptedProvider([
      responseWithCalls("echo", "echo"), // two announced calls…
      plain("done after results"), // …the loop then stops on this reply
    ])
    const { allToolCalls } = await runToolLoop(
      makeLoop(provider),
      [{ role: "user", content: "go" }],
      {
        maxToolCalls: 1,
        maxRounds: 5,
      },
    )
    // Both calls end settled: one executed, one with the uncalled error.
    expect(allToolCalls).toHaveLength(2)
    const nextRound = provider.requests[1]!
    const resultMessages = nextRound.filter((c) => c.startsWith("[Tool Result: echo]"))
    expect(resultMessages).toHaveLength(2)
    expect(resultMessages.some((c) => c.includes(UNCALLED_TOOL_CALL_ERROR))).toBe(true)
    // The executed call's result is also present.
    expect(resultMessages.some((c) => c.includes('"x":1') || c.includes('"x": 1'))).toBe(true)
  })

  it("budget truncation before the round settles the dropped calls", async () => {
    const provider = new ScriptedProvider([
      responseWithCalls("echo", "echo", "echo"),
      plain("done"),
    ])
    const events: RuntimeEvent[] = []
    const { allToolCalls } = await runToolLoop(
      makeLoop(provider),
      [{ role: "user", content: "go" }],
      { maxToolCalls: 2, maxRounds: 5, emitEvent: (e) => events.push(e) },
    )
    expect(allToolCalls).toHaveLength(3)
    const nextRound = provider.requests[1]!
    const uncalled = nextRound.filter((c) => c.includes(UNCALLED_TOOL_CALL_ERROR))
    expect(uncalled).toHaveLength(1)
    // A structured tool-end error event fired for the uncalled call.
    const uncalledEnd = events.filter(
      (e) => e.type === "tool-end" && !e.ok && e.error === UNCALLED_TOOL_CALL_ERROR,
    )
    expect(uncalledEnd).toHaveLength(1)
  })

  it("zero remaining budget settles every announced call before returning", async () => {
    const provider = new ScriptedProvider([
      responseWithCalls("echo", "echo"),
      responseWithCalls("echo", "echo"),
      plain("never asked"),
    ])
    const events: RuntimeEvent[] = []
    const { allToolCalls, response } = await runToolLoop(
      makeLoop(provider),
      [{ role: "user", content: "go" }],
      { maxToolCalls: 2, maxRounds: 5, emitEvent: (e) => events.push(e) },
    )
    // Round 0: both executed. Round 1 announces two more with no budget left:
    // the zero-budget early return settles both before returning.
    expect(allToolCalls).toHaveLength(4)
    expect(allToolCalls.slice(2).every((c) => c.name === "echo")).toBe(true)
    const uncalledEnds = events.filter(
      (e) => e.type === "tool-end" && !e.ok && e.error === UNCALLED_TOOL_CALL_ERROR,
    )
    expect(uncalledEnds).toHaveLength(2)
    // The truncated response carries no dangling tool calls.
    expect(response.toolCalls).toEqual([])
  })

  it("fully executed rounds leave no uncalled errors in the context", async () => {
    const provider = new ScriptedProvider([responseWithCalls("echo"), plain("done")])
    const { allToolCalls } = await runToolLoop(
      makeLoop(provider),
      [{ role: "user", content: "go" }],
      { maxToolCalls: 5, maxRounds: 5 },
    )
    expect(allToolCalls).toHaveLength(1)
    expect(provider.requests[1]!.some((c) => c.includes(UNCALLED_TOOL_CALL_ERROR))).toBe(false)
  })
})
