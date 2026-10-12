// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT

/**
 * Context-overflow recovery in the tool loop (minimax 5b4e0a4 borrowing):
 * the provider rejects the request as too large, the loop force-compacts
 * through the recovery hook and resends EXACTLY ONCE through the same
 * provider.chat call site (the normal before-LLM pipeline), and a second
 * rejection is terminal.
 */
import { describe, expect, it } from "vitest"
import { makeTool } from "@max/llm"
import { ToolEnabledProvider, createToolRegistry, runToolLoop } from "../src/tool-integration.js"
import type { ChatMessage, ChatOptions, ChatResponse, Provider } from "@max/providers"

class ScriptedProvider implements Provider {
  id = "scripted"
  name = "scripted"
  defaultModel = "scripted-1"
  isConfigured(): boolean {
    return true
  }
  /** Chat call log: every request the pipeline actually sent. */
  readonly requests: ChatMessage[][] = []
  private step = 0
  constructor(private readonly script: Array<(messages: ChatMessage[]) => Promise<ChatResponse>>) {}
  async chat(messages: ChatMessage[], _options?: ChatOptions): Promise<ChatResponse> {
    this.requests.push(messages.map((m) => ({ ...m })))
    const handler = this.script[Math.min(this.step, this.script.length - 1)]!
    this.step++
    return handler(messages)
  }
  async *stream(): AsyncIterable<never> {
    throw new Error("not used")
  }
}

/** A ProviderError-shaped rejection with a status code (maximally realistic). */
class OversizedError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message)
    this.name = "ProviderError"
  }
}

const plain = (content: string): ChatResponse => ({
  content,
  model: "scripted-1",
  usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
})

const toolCallResponse = (name: string): ChatResponse => ({
  content: "```tool\n" + JSON.stringify({ name, input: { x: 1 } }) + "\n```\nworking",
  model: "scripted-1",
  usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
})

const makeLoop = (provider: Provider): ToolEnabledProvider => {
  const registry = createToolRegistry()
  registry.register({
    echo: makeTool({
      name: "echo",
      description: "echo the input back",
      kind: "misc",
      inputSchema: { type: "object" },
      execute: async (input) => input,
    }),
  })
  return new ToolEnabledProvider(provider, registry)
}

describe("runToolLoop context-overflow recovery", () => {
  it("force-compacts and resends exactly once through the normal pipeline", async () => {
    const provider = new ScriptedProvider([
      async () => {
        throw new OversizedError("[scripted] request too large", 413)
      },
      async () => plain("recovered reply"),
    ])
    const seenByHook: ChatMessage[][] = []
    const { response } = await runToolLoop(
      makeLoop(provider),
      [
        { role: "user", content: "long history" },
        { role: "user", content: "question" },
      ],
      {
        contextOverflowRecovery: async (rejected) => {
          seenByHook.push(rejected.map((m) => ({ ...m })))
          // Force-compaction: drop everything but the last message.
          return rejected.slice(-1)
        },
      },
    )
    expect(response.content).toBe("recovered reply")
    // Exactly two physical requests: the rejected one and the resend.
    expect(provider.requests).toHaveLength(2)
    // The hook saw the same live history the loop owns.
    expect(seenByHook).toHaveLength(1)
    expect(seenByHook[0]).toHaveLength(2)
    // The RESEND carried the compacted history (last message only) and still
    // went through provider.chat — the pipeline call site, never bypassed.
    expect(provider.requests[1]).toEqual([{ role: "user", content: "question" }])
  })

  it("a second rejection is terminal: the hook runs once, the error surfaces", async () => {
    const provider = new ScriptedProvider([
      async () => {
        throw new OversizedError("[scripted] context length exceeded", 400)
      },
      async () => {
        throw new OversizedError("[scripted] context length exceeded", 400)
      },
    ])
    let hookCalls = 0
    await expect(
      runToolLoop(makeLoop(provider), [{ role: "user", content: "big" }], {
        contextOverflowRecovery: async (rejected) => {
          hookCalls++
          return rejected.slice(-1)
        },
      }),
    ).rejects.toThrow("context length exceeded")
    expect(hookCalls).toBe(1)
    expect(provider.requests).toHaveLength(2)
  })

  it("counts the recovery attempt across rounds, not per round", async () => {
    // Round 1: rejected → recovery → resend succeeds and issues a tool call
    // (the loop continues into round 2); round 2 is rejected again → the
    // per-RUN budget is spent, so the second rejection is terminal.
    const provider = new ScriptedProvider([
      async () => {
        throw new OversizedError("request_too_large", 413)
      },
      async () => toolCallResponse("echo"),
      async () => {
        throw new OversizedError("request_too_large", 413)
      },
    ])
    let hookCalls = 0
    await expect(
      runToolLoop(makeLoop(provider), [{ role: "user", content: "big" }], {
        maxRounds: 5,
        contextOverflowRecovery: async (rejected) => {
          hookCalls++
          return rejected.slice(-1)
        },
      }),
    ).rejects.toThrow("request_too_large")
    expect(hookCalls).toBe(1)
    // Rejected request + successful resend + second rejected request.
    expect(provider.requests).toHaveLength(3)
  })

  it("surfaces the original rejection when the hook cannot change anything", async () => {
    const provider = new ScriptedProvider([
      async () => {
        throw new OversizedError("payload too large", 413)
      },
    ])
    await expect(
      runToolLoop(makeLoop(provider), [{ role: "user", content: "big" }], {
        contextOverflowRecovery: async () => undefined,
      }),
    ).rejects.toThrow("payload too large")
    // No blind resend when recovery changed nothing.
    expect(provider.requests).toHaveLength(1)
  })

  it("a throwing hook must not mask the provider rejection", async () => {
    const provider = new ScriptedProvider([
      async () => {
        throw new OversizedError("payload too large", 413)
      },
    ])
    await expect(
      runToolLoop(makeLoop(provider), [{ role: "user", content: "big" }], {
        contextOverflowRecovery: async () => {
          throw new Error("compactor exploded")
        },
      }),
    ).rejects.toThrow("payload too large")
    expect(provider.requests).toHaveLength(1)
  })

  it("non-oversized errors never trigger recovery", async () => {
    const provider = new ScriptedProvider([
      async () => {
        throw new OversizedError("rate limit exceeded", 429)
      },
    ])
    let hookCalls = 0
    await expect(
      runToolLoop(makeLoop(provider), [{ role: "user", content: "x" }], {
        contextOverflowRecovery: async () => {
          hookCalls++
          return []
        },
      }),
    ).rejects.toThrow("rate limit exceeded")
    expect(hookCalls).toBe(0)
    expect(provider.requests).toHaveLength(1)
  })

  it("without the hook configured, oversized errors propagate untouched", async () => {
    const provider = new ScriptedProvider([
      async () => {
        throw new OversizedError("request too large", 413)
      },
    ])
    await expect(runToolLoop(makeLoop(provider), [{ role: "user", content: "x" }])).rejects.toThrow(
      "request too large",
    )
    expect(provider.requests).toHaveLength(1)
  })
})
