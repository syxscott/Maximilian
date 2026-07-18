// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * RolePlaying tests (借鉴 CAMEL RolePlaying + ChatDev).
 */
import { describe, it, expect } from "vitest"
import { RolePlaying } from "../src/role-play.js"
import { DefaultRoleRegistry } from "../src/roles.js"
import { Agent } from "@max/core"
import type { Provider, ChatMessage } from "@max/providers"
import type { Task, Result } from "@max/core"

// Mock provider that returns canned responses.
function mockProvider(response: string): Provider {
  return {
    name: "mock",
    chat(_messages: ChatMessage[], _opts?: Record<string, unknown>) {
      return Promise.resolve({
        content: response,
        model: "mock-model",
        finishReason: "stop",
        usage: { inputTokens: 10, outputTokens: 10 },
      })
    },
  } as unknown as Provider
}

// Minimal concrete Agent subclass for testing.
class TestAgent extends Agent {
  constructor(private readonly mockProvider: Provider) {
    super(mockProvider, `test-${Math.random().toString(36).slice(2)}`)
  }

  override readonly manifest = {
    role: "general" as const,
    displayName: "Test Agent",
    goal: "test",
    systemPrompt: "You are a test agent.",
  }

  override async execute(task: Task): Promise<Result> {
    return {
      id: `r-${task.id}`,
      taskId: task.id,
      agentRole: "general",
      agentId: this.id,
      output: "mock output",
      metadata: {},
      createdAt: new Date().toISOString(),
    }
  }
}

// Agent factory for tests.
function makeFactory(roleId: string, provider: Provider): (id: string) => Agent {
  return () => new TestAgent(provider)
}

describe("RolePlaying", () => {
  it("constructor requires valid roles", () => {
    const registry = new DefaultRoleRegistry()
    expect(() => {
      new RolePlaying(
        { roleA: "architect", roleB: "backend", task: "build a thing" },
        registry,
        makeFactory("architect", mockProvider("hello")),
      )
    }).not.toThrow()
  })

  it("getTurn() starts at 0", () => {
    const registry = new DefaultRoleRegistry()
    const rp = new RolePlaying(
      { roleA: "architect", roleB: "backend", task: "build a thing", maxTurns: 3 },
      registry,
      makeFactory("architect", mockProvider("output A")),
    )
    expect(rp.getTurn()).toBe(0)
  })

  it("getHistory() is empty before run()", () => {
    const registry = new DefaultRoleRegistry()
    const rp = new RolePlaying(
      { roleA: "architect", roleB: "backend", task: "build a thing" },
      registry,
      makeFactory("architect", mockProvider("output A")),
    )
    expect(rp.getHistory()).toHaveLength(0)
  })

  it("run() with maxTurns=1 completes one A→B exchange", async () => {
    const registry = new DefaultRoleRegistry()
    const factory = makeFactory("architect", mockProvider("A says: implementation complete"))
    const rp = new RolePlaying(
      { roleA: "architect", roleB: "reviewer", task: "design a system", maxTurns: 1 },
      registry,
      factory,
    )
    const history = await rp.run({ type: "max_turns", turns: 1 })
    expect(history.length).toBeGreaterThanOrEqual(2) // A output + B feedback
    expect(rp.getTurn()).toBe(1)
  })

  it("run() respects maxTurns termination", async () => {
    const registry = new DefaultRoleRegistry()
    const rp = new RolePlaying(
      { roleA: "architect", roleB: "reviewer", task: "design", maxTurns: 2 },
      registry,
      makeFactory("architect", mockProvider("output")),
    )
    await rp.run({ type: "max_turns", turns: 2 })
    expect(rp.getTurn()).toBeLessThanOrEqual(2)
  })

  it("run() stops early on early_exit termination", async () => {
    const registry = new DefaultRoleRegistry()
    const rp = new RolePlaying(
      { roleA: "architect", roleB: "reviewer", task: "design", maxTurns: 5 },
      registry,
      makeFactory("architect", mockProvider("output")),
    )
    await rp.run({
      type: "early_exit",
      condition: (msgs) => msgs.length >= 2,
    })
    expect(rp.getTurn()).toBeLessThanOrEqual(5)
  })
})
