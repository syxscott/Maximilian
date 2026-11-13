// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT

/**
 * Review bundle refusal annotation (deepseek chat-demo reply.ts
 * isUsableReply borrowing): refused results entering the review handoff
 * bundle are annotated with the refusal marker — the review agent's whole
 * input — aligned with the runtime's existing unverified-draft marker
 * pattern. The annotation is idempotent, so results already marked by the
 * runtime's priorResults assembly are never double-marked.
 */
import { describe, expect, it } from "vitest"
import { ReviewAgent } from "../src/review.js"
import { REFUSED_RESULT_MARKER } from "@max/core"
import type { AgentContext, Result } from "@max/core"
import type { ChatMessage, ChatResponse, Provider } from "@max/providers"

class CapturingProvider implements Provider {
  id = "capture"
  name = "capture"
  defaultModel = "capture-1"
  isConfigured(): boolean {
    return true
  }
  /** The system + user messages the review agent assembled. */
  lastRequest: ChatMessage[] = []
  async chat(messages: ChatMessage[]): Promise<ChatResponse> {
    this.lastRequest = messages
    return {
      content: JSON.stringify({ score: 7, issues: [], suggestions: [], summary: "ok" }),
      model: "capture-1",
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    }
  }
  async *stream(): AsyncIterable<never> {
    throw new Error("not used")
  }
}

const makeResult = (overrides: Partial<Result> & Pick<Result, "id" | "output">): Result => ({
  taskId: "t1",
  agentRole: "backend",
  agentId: "agent-1",
  metadata: {},
  createdAt: new Date().toISOString(),
  ...overrides,
})

const makeCtx = (results: Result[]): AgentContext => ({ priorResults: results })

const TASK = {
  id: "t-review",
  agentRole: "review" as const,
  description: "review it",
  dependsOn: [],
  status: "pending" as const,
}

async function runReview(ctx: AgentContext): Promise<ChatMessage[]> {
  const provider = new CapturingProvider()
  const agent = new ReviewAgent(provider)
  await agent.execute(TASK, ctx)
  return provider.lastRequest
}

describe("review bundle refusal annotation", () => {
  it("annotates a refused result in the handoff bundle", async () => {
    const messages = await runReview(
      makeCtx([
        makeResult({ id: "r-1", output: "partial output", metadata: { refused: true } }),
        makeResult({ id: "r-2", output: "clean output" }),
      ]),
    )
    const prompt = messages.map((m) => m.content).join("\n")
    expect(prompt).toContain(REFUSED_RESULT_MARKER)
    expect(prompt).toContain("partial output")
    // The clean sibling stays unannotated.
    const markerCount = prompt.match(/refused — do not rely/g)?.length ?? 0
    expect(markerCount).toBe(1)
  })

  it("does not double-mark results already annotated by the runtime", async () => {
    const preMarked = `${REFUSED_RESULT_MARKER}\npartial output`
    const messages = await runReview(
      makeCtx([makeResult({ id: "r-1", output: preMarked, metadata: { refused: true } })]),
    )
    const prompt = messages.map((m) => m.content).join("\n")
    expect(prompt.match(/refused — do not rely/g)).toHaveLength(1)
  })

  it("leaves non-refused bundles untouched", async () => {
    const messages = await runReview(makeCtx([makeResult({ id: "r-1", output: "solid output" })]))
    const prompt = messages.map((m) => m.content).join("\n")
    expect(prompt).not.toContain("refused — do not rely")
    expect(prompt).toContain("solid output")
  })
})
