// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT

/**
 * Refusal settlement in the tool loop (deepseek chat-demo reply.ts
 * settleReply borrowing): a response with finishReason "refusal" is a
 * terminal state — the loop must end immediately (no further tool round, no
 * follow-up turn), the response must carry the refused settlement flag with
 * parsed tool calls cleared, and the partial body is preserved for audit.
 *
 * Also verifies the provider-finishReason propagation seam: the wrapper
 * previously dropped ChatResponse.finishReason on the floor, so neither
 * the "length" truncation gate nor the refusal gate could ever fire.
 */
import { describe, expect, it } from "vitest"
import { makeTool } from "@max/llm"
import { ToolEnabledProvider, createToolRegistry, runToolLoop } from "../src/tool-integration.js"
import type { ChatResponse, Provider } from "@max/providers"
import { REFUSED_RESULT_MARKER } from "../src/refusal.js"

const toolBlock = (name: string, input: unknown): string =>
  "```tool\n" + JSON.stringify({ name, input }) + "\n```"

const refusalWithToolCall: ChatResponse = {
  content: `I can't help with that.\n${toolBlock("echo", { x: 1 })}`,
  model: "scripted-1",
  usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
  finishReason: "refusal",
}

const plain = (content: string, finishReason?: string): ChatResponse => ({
  content,
  model: "scripted-1",
  usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
  finishReason,
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

describe("runToolLoop refusal settlement", () => {
  it("a refused first round terminates the loop after exactly one LLM call", async () => {
    const provider = new ScriptedProvider([refusalWithToolCall, plain("never asked")])
    const { response, allToolCalls } = await runToolLoop(
      makeLoop(provider),
      [{ role: "user", content: "go" }],
      { maxRounds: 5 },
    )
    // Exactly one LLM call: the refusal is terminal even though the partial
    // body parsed a tool call.
    expect(provider.requests).toHaveLength(1)
    expect(allToolCalls).toHaveLength(0)
    expect(response.refused).toBe(true)
    // Parsed tool calls from refused content are cleared — never executed,
    // never settled into the context.
    expect(response.toolCalls).toEqual([])
    // Raw body preserved for audit (no physical deletion).
    expect(response.content).toContain("I can't help with that.")
    expect(response.stopReason).toBe("refusal")
  })

  it("a refusal skips follow-up injection entirely", async () => {
    const provider = new ScriptedProvider([refusalWithToolCall, plain("never asked")])
    let followUpsDrained = false
    const { response } = await runToolLoop(makeLoop(provider), [{ role: "user", content: "go" }], {
      maxRounds: 5,
      getFollowUpMessages: () => {
        followUpsDrained = true
        return [{ role: "user", content: "queued follow-up" }]
      },
    })
    expect(provider.requests).toHaveLength(1)
    expect(followUpsDrained).toBe(false)
    expect(response.refused).toBe(true)
  })

  it("a refused post-rounds response settles without a follow-up turn", async () => {
    // Round 0 executes a tool; the rounds budget then exhausts and the
    // post-rounds final call comes back refused. The refusal must settle
    // the turn BEFORE the follow-up drain happens.
    const provider = new ScriptedProvider([
      plain(toolBlock("echo", { x: 1 }), "stop"),
      refusalWithToolCall,
    ])
    let followUpsDrained = false
    const { response } = await runToolLoop(makeLoop(provider), [{ role: "user", content: "go" }], {
      maxRounds: 1,
      getFollowUpMessages: () => {
        followUpsDrained = true
        return [{ role: "user", content: "queued follow-up" }]
      },
    })
    expect(provider.requests).toHaveLength(2)
    expect(response.refused).toBe(true)
    expect(response.toolCalls).toEqual([])
    expect(followUpsDrained).toBe(false)
  })

  it("a refused explicit-stop response settles with the refused flag", async () => {
    const provider = new ScriptedProvider([refusalWithToolCall])
    const { response } = await runToolLoop(makeLoop(provider), [{ role: "user", content: "go" }], {
      maxRounds: 5,
      shouldStopAfterTurn: () => true,
    })
    expect(response.refused).toBe(true)
    expect(response.toolCalls).toEqual([])
  })

  it("an unfinished tool round disqualifies the follow-up assistant prefix", async () => {
    // Round 0 executes a tool and the rounds budget exhausts; the
    // post-rounds final call announces another tool call that will never be
    // executed. That unfinished tool round disqualifies the response from
    // becoming the assistant prefix of the follow-up request (chat-demo
    // canContinueReply tool_use leg).
    const provider = new ScriptedProvider([
      plain(toolBlock("echo", { x: 1 }), "stop"),
      plain(`announced but never executed\n${toolBlock("echo", { x: 1 })}`, "stop"),
    ])
    const { response } = await runToolLoop(makeLoop(provider), [{ role: "user", content: "go" }], {
      maxRounds: 1,
      getFollowUpMessages: () => [{ role: "user", content: "queued follow-up" }],
    })
    // The follow-up turn DID happen (bounded single injection): round 0,
    // the post-rounds final call, then the follow-up call.
    expect(provider.requests).toHaveLength(3)
    // The untrusted assistant prefix was withheld from the follow-up
    // request; the follow-up itself is present.
    const followUpRequest = provider.requests[2]!
    expect(followUpRequest.some((c) => c.includes("announced but never executed"))).toBe(false)
    expect(followUpRequest.some((c) => c.includes("queued follow-up"))).toBe(true)
    expect(response.stopReason).toBe("stop")
  })

  it("a usable final response keeps its place as the follow-up assistant prefix", async () => {
    const provider = new ScriptedProvider([plain("complete answer", "stop")])
    await runToolLoop(makeLoop(provider), [{ role: "user", content: "go" }], {
      maxRounds: 1,
      getFollowUpMessages: () => [{ role: "user", content: "queued follow-up" }],
    })
    const followUpRequest = provider.requests[1]!
    expect(followUpRequest.some((c) => c.includes("complete answer"))).toBe(true)
  })

  it("non-refusal loop behaviour is unchanged (two rounds, tool executed)", async () => {
    const provider = new ScriptedProvider([
      plain(toolBlock("echo", { x: 1 }), "stop"),
      plain("done after results", "stop"),
    ])
    const { response, allToolCalls } = await runToolLoop(
      makeLoop(provider),
      [{ role: "user", content: "go" }],
      { maxRounds: 5 },
    )
    expect(provider.requests).toHaveLength(2)
    expect(allToolCalls).toHaveLength(1)
    expect(response.refused).toBeUndefined()
    expect(response.content).toBe("done after results")
  })
})

describe("ToolEnabledProvider finishReason propagation", () => {
  it("maps a refused ChatResponse to stopReason + refused on the loop response", async () => {
    const provider = new ScriptedProvider([refusalWithToolCall])
    const res = await makeLoop(provider).chat([{ role: "user", content: "go" }])
    expect(res.stopReason).toBe("refusal")
    expect(res.refused).toBe(true)
    // Tool calls parsed from refused content are still handed to the loop —
    // the LOOP clears them via settleRefusal (single settlement point).
    expect(res.toolCalls).toHaveLength(1)
  })

  it("passes non-refusal finishReasons through as stopReason (length gate stays live)", async () => {
    const provider = new ScriptedProvider([plain(toolBlock("echo", { x: 1 }), "length")])
    const res = await makeLoop(provider).chat([{ role: "user", content: "go" }])
    expect(res.stopReason).toBe("length")
    expect(res.refused).toBeUndefined()
  })

  it("annotates a refused result body aligned with the unverified-draft marker style", () => {
    // Marker constant sanity: the runtime and the review bundle both prefix
    // refused bodies with exactly this annotation.
    expect(REFUSED_RESULT_MARKER).toBe("[refused — do not rely on partial content]")
  })
})
