// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT

/**
 * Refusal data-flow through the runtime (deepseek chat-demo reply.ts
 * settleReply borrowing): a refused LLM turn reaches the runtime as
 * `ToolEnabledResponse.refused` from the tool loop, lands as
 * `Result.metadata.refused`, is surfaced on the `task-complete` event, and
 * is annotated in the priorResults context handed to downstream agents
 * (aligned with the existing unverified-draft failureDetector markers).
 */
import { describe, expect, it } from "vitest"
import { AgentRuntime } from "../src/runtime.js"
import { Agent, type AgentContext } from "../src/agent.js"
import { ToolEnabledProvider, createToolRegistry } from "../src/tool-integration.js"
import { REFUSED_RESULT_MARKER } from "../src/refusal.js"
import type { AgentManifest, Plan, Result, RuntimeEvent, Task, Workspace } from "../src/types.js"
import type { ChatMessage, ChatResponse, Provider } from "@max/providers"

const STUB_MANIFEST: AgentManifest = {
  role: "general",
  displayName: "Stub",
  goal: "stub",
  systemPrompt: "stub",
}

type Script = { content: string; finishReason?: string }

class ScriptedProvider implements Provider {
  id = "stub"
  name = "stub"
  defaultModel = "stub-1"
  isConfigured(): boolean {
    return true
  }
  private step = 0
  constructor(private readonly script: Script[]) {}
  async chat(_messages: ChatMessage[]): Promise<ChatResponse> {
    const next = this.script[Math.min(this.step++, this.script.length - 1)]!
    return {
      content: next.content,
      model: "stub-1",
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      finishReason: next.finishReason,
    }
  }
  async *stream(): AsyncIterable<never> {
    throw new Error("not used")
  }
}

/**
 * A tool-loop agent whose LLM responses follow a script. Downstream agents
 * capture the priorResults context they were handed so the test can assert
 * the refusal annotation flow.
 */
class ScriptedToolAgent extends Agent {
  override readonly manifest = STUB_MANIFEST
  private readonly toolProvider: ToolEnabledProvider
  /** Context seen by the LAST execute call (downstream verification). */
  static lastSeenPriorOutputs: string[] = []
  constructor(script: Script[]) {
    super(new ScriptedProvider(script))
    this.toolProvider = new ToolEnabledProvider(new ScriptedProvider(script), createToolRegistry())
  }
  override getToolProvider(): ToolEnabledProvider | undefined {
    return this.toolProvider
  }
  // The tool-loop path calls buildChatMessages(task, ctx) BEFORE running the
  // loop (execute() itself is bypassed) — that is where the runtime hands
  // over the annotated priorResults context.
  override buildChatMessages(task: Task, ctx: AgentContext): ChatMessage[] {
    ScriptedToolAgent.lastSeenPriorOutputs = ctx.priorResults.map((r) => r.output)
    return super.buildChatMessages(task, ctx)
  }
  override async execute(task: Task, _ctx: AgentContext): Promise<Result> {
    return {
      id: `r-${Math.random().toString(36).slice(2, 8)}`,
      taskId: task.id,
      agentRole: task.agentRole,
      output: "unused — the tool loop result wins",
    }
  }
}

function makeWorkspace(id: string, tasks: Task[]): Workspace {
  const plan: Plan = { tasks, edges: [] }
  return {
    id,
    userRequest: "x",
    plan,
    results: [],
    status: "pending",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

const makeTask = (id: string): Task => ({
  id,
  description: `task ${id}`,
  agentRole: "general",
  dependsOn: [],
  status: "pending",
})

function makeSink() {
  return {
    workspaces: new Map<string, Workspace>(),
    async saveWorkspace(w: Workspace) {
      this.workspaces.set(w.id, w)
    },
    async loadWorkspace(id: string) {
      return this.workspaces.get(id)
    },
  }
}

describe("runtime refusal flow", () => {
  it("a refused turn lands metadata.refused, flags task-complete, and annotates downstream context", async () => {
    const events: RuntimeEvent[] = []
    // Task t1's loop: the LLM refuses with a tool call in the partial body.
    // Task t2's agent (downstream in the same workspace) sees the annotated
    // prior result.
    const refusedScript: Script[] = [
      {
        content: "I can't help with that.",
        finishReason: "refusal",
      },
    ]
    const downstreamScript: Script[] = [{ content: "noted", finishReason: "stop" }]
    let agentIndex = 0
    const rt = new AgentRuntime(
      () => {
        agentIndex++
        return agentIndex === 1
          ? new ScriptedToolAgent(refusedScript)
          : new ScriptedToolAgent(downstreamScript)
      },
      makeSink(),
      { enableToolLoop: true, maxConcurrency: 1 },
    )
    const workspace = makeWorkspace("w-refusal", [makeTask("t1"), makeTask("t2")])
    rt.on((event) => events.push(event))
    const updated = await rt.execute(workspace)

    // Task-complete carries the refused observability flag on t1.
    const complete = events.find((e) => e.type === "task-complete" && e.taskId === "t1") as
      Extract<RuntimeEvent, { type: "task-complete" }> | undefined
    expect(complete).toBeDefined()
    expect(complete!.refused).toBe(true)

    // The stored Result carries the refusal marker in metadata (persistence
    // seam — Result.metadata is an arbitrary key-value record).
    const refusedResult = updated.results.find((r) => r.taskId === "t1")
    expect(refusedResult).toBeDefined()
    expect((refusedResult!.metadata as { refused?: boolean }).refused).toBe(true)
    // Raw partial body preserved for audit — the annotation lives on top.
    expect(refusedResult!.output).toBe("I can't help with that.")

    // Downstream agent (t2) received the annotated prior result, aligned
    // with the unverified-draft marker pattern.
    expect(ScriptedToolAgent.lastSeenPriorOutputs).toHaveLength(1)
    expect(ScriptedToolAgent.lastSeenPriorOutputs[0]!.startsWith(REFUSED_RESULT_MARKER)).toBe(true)
  })
})
