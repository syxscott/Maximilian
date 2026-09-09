/**
 * Steering + follow-up hooks (借鉴 openclaw agent-loop.ts:258-389).
 *
 * The tool loop accepts optional hooks:
 *   - getSteeringMessages(): called BEFORE each provider.chat(); injects
 *     messages into the current conversation while the loop is running.
 *   - getFollowUpMessages(): called AFTER the loop naturally exits, if it
 *     returns messages the loop does ONE more full turn.
 *   - prepareNextTurn(): called before each provider.chat() for state prep.
 *   - shouldStopAfterTurn(): called after each iteration; if true, the
 *     loop exits early with the current accumulated state.
 *
 * Verifies:
 *   - Steering messages are injected before each chat
 *   - Follow-up messages trigger an extra turn after loop exit
 *   - prepareNextTurn is called before each chat
 *   - shouldStopAfterTurn causes early exit
 *   - No regression when hooks are undefined
 */
import { describe, it, expect, vi } from "vitest"
import {
  runToolLoop,
  ToolEnabledProvider,
  createToolRegistry,
  type ToolCall,
} from "../src/tool-integration.js"
import type { Provider, ChatMessage, ChatResponse } from "@max/providers"

class EchoProvider implements Provider {
  id = "stub"
  name = "stub"
  defaultModel = "stub-1"
  isConfigured(): boolean { return true }
  /** ALWAYS returns the same tool call so the loop keeps going. */
  async chat(_messages: ChatMessage[]): Promise<ChatResponse> {
    return {
      content: '```tool\n{"name":"echo","input":{"x":1}}\n```',
      model: "stub-1",
      usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 },
    }
  }
  async *stream() { throw new Error("not used") }
}

class StopProvider implements Provider {
  id = "stub"
  name = "stub"
  defaultModel = "stub-1"
  isConfigured(): boolean { return true }
  private callIndex = 0
  async chat(_messages: ChatMessage[]): Promise<ChatResponse> {
    this.callIndex++
    // On the first call, return a tool call to exercise the loop.
    // On the second call, return no tool calls (loop would naturally exit).
    if (this.callIndex <= 1) {
      return {
        content: '```tool\n{"name":"echo","input":{"x":1}}\n```',
        model: "stub-1",
        usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 },
      }
    }
    return {
      content: "done",
      model: "stub-1",
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    }
  }
  async *stream() { throw new Error("not used") }
}

function buildProvider(): { provider: ToolEnabledProvider; registry: ReturnType<typeof createToolRegistry> } {
  const registry = createToolRegistry()
  registry.register({
    echo: {
      name: "echo",
      description: "echo",
      inputSchema: { type: "object", properties: { x: { type: "number" } } },
      async execute(input: { x: number }) {
        return { result: input.x, output: { structured: input.x, content: [{ type: "text" as const, text: String(input.x) }] } }
      },
    } as never,
  })
  return { provider: new ToolEnabledProvider(new EchoProvider(), registry), registry }
}

describe("Steering hooks (借鉴 openclaw)", () => {
  it("getSteeringMessages injects messages before each chat", async () => {
    const { provider } = buildProvider()
    const steering = vi.fn(() => [
      { role: "user" as const, content: "steering message" },
    ])
    await runToolLoop(provider, [{ role: "user", content: "go" }], {
      maxRounds: 2,
      getSteeringMessages: steering,
    })
    // Called before each of the 2 rounds.
    expect(steering).toHaveBeenCalledTimes(2)
  })

  it("getFollowUpMessages triggers an extra turn after loop exit", async () => {
    const { provider: prov } = buildProvider()
    // Use a provider that stops after the first tool call so the loop
    // naturally exits and we can observe the follow-up turn.
    const registry = createToolRegistry()
    registry.register({
      echo: {
        name: "echo",
        description: "echo",
        inputSchema: { type: "object", properties: { x: { type: "number" } } },
        async execute(input: { x: number }) {
          return { result: input.x, output: { structured: input.x, content: [{ type: "text" as const, text: String(input.x) }] } }
        },
      } as never,
    })
    const stopProvider = new StopProvider()
    const provider = new ToolEnabledProvider(stopProvider, registry)
    const followUp = vi.fn(() => [
      { role: "user" as const, content: "follow-up question" },
    ])
    await runToolLoop(provider, [{ role: "user", content: "go" }], {
      maxRounds: 3,
      getFollowUpMessages: followUp,
    })
    // Follow-up is called once after the tool loop exits.
    expect(followUp).toHaveBeenCalledTimes(1)
  })

  it("prepareNextTurn is called before each provider.chat()", async () => {
    const { provider } = buildProvider()
    const prep = vi.fn()
    await runToolLoop(provider, [{ role: "user", content: "go" }], {
      maxRounds: 2,
      prepareNextTurn: prep,
    })
    // Called before each round (2 rounds).
    expect(prep).toHaveBeenCalledTimes(2)
  })

  it("shouldStopAfterTurn exits the loop early", async () => {
    const { provider } = buildProvider()
    const stop = vi.fn()
    // Return true after the first turn.
    stop.mockReturnValueOnce(false).mockReturnValue(true)
    const result = await runToolLoop(provider, [{ role: "user", content: "go" }], {
      maxRounds: 5,
      shouldStopAfterTurn: stop,
    })
    // The loop exited after 2 checks (first false, second true).
    expect(stop).toHaveBeenCalledTimes(2)
    // We still got a response.
    expect(result.response).toBeDefined()
  })

  it("no hooks defined — no regression", async () => {
    const { provider } = buildProvider()
    const result = await runToolLoop(provider, [{ role: "user", content: "go" }], {
      maxRounds: 1,
    })
    expect(result.response).toBeDefined()
  })
})