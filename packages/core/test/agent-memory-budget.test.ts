// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Agent.buildMessages budget regression: every memory entry handed to the
 * LLM must be capped like the user message. The pre-Wave-C code computed a
 * truncated `memoryText` block and then dropped it, so an oversized memory
 * entry was replayed verbatim on every call while `recall()` stayed intact.
 */
import { describe, expect, it } from "vitest"
import { Agent, type AgentContext } from "../src/agent.js"
import type { ChatMessage } from "@max/providers"
import type { AgentManifest, Result, Task } from "../src/types.js"

const MANIFEST: AgentManifest = {
  role: "general",
  displayName: "Probe",
  goal: "probe",
  systemPrompt: "PROBE_SYSTEM",
} as AgentManifest

class ProbeAgent extends Agent {
  override readonly manifest = MANIFEST
  override async execute(_task: Task, _ctx: AgentContext): Promise<Result> {
    throw new Error("not used")
  }
}

const MAX = 80_000

describe("Agent.buildMessages memory budget", () => {
  it("caps oversized memory entries in the request copy but keeps recall() intact", () => {
    const agent = new ProbeAgent({ id: "p", name: "p", defaultModel: "m" } as never)
    const long = `lead-${"x".repeat(MAX + 500)}`
    agent.remember({ role: "assistant", content: long })

    const messages: ChatMessage[] = agent.buildChatMessages(
      { id: "t", agentRole: "general", description: "do it", dependsOn: [], status: "pending" },
      { priorResults: [] },
    )

    const memoryMsg = messages.find((m) => m.role === "assistant")
    expect(memoryMsg?.content.length).toBeLessThanOrEqual(MAX)
    expect(memoryMsg?.content.endsWith("...")).toBe(true)
    // The stored memory itself is untouched for recall()/other consumers.
    expect(agent.recall()[0]?.content).toBe(long)
  })
})
