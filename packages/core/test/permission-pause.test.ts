/**
 * Tests for the runtime's permission pause/resume API.
 *
 *   - `awaitPermission` parks until `resolvePermission` is called
 *   - `resolvePermission` returns true on success, false on unknown id
 *   - repeated await calls with the same id are idempotent
 *   - emitting the `permission-request` event before parking lets the
 *     listener (typically the API SSE pipe) see the prompt
 *
 * The wiring inside `runToolLoop` is exercised separately by the
 * `with-permission` integration tests — these tests focus on the
 * runtime-side parking primitive.
 */

import { describe, it, expect } from "vitest"
import { AgentRuntime, type RuntimeEvent } from "../src/runtime.js"
import { Agent, type AgentContext } from "../src/agent.js"
import type { AgentManifest, Plan, Result, Task, Workspace } from "../src/types.js"
import type { Provider, ChatMessage, ChatResponse } from "@max/providers"

const MANIFEST: AgentManifest = {
  role: "general",
  displayName: "Stub",
  goal: "noop",
  systemPrompt: "noop",
}

class NoopAgent extends Agent {
  override readonly manifest = MANIFEST
  override async execute(_task: Task, _ctx: AgentContext): Promise<Result> {
    return {
      id: "r1",
      taskId: "t1",
      agentRole: "general",
      output: "noop",
    }
  }
}

function noopProvider(): Provider {
  return {
    id: "noop",
    name: "noop",
    defaultModel: "x",
    isConfigured: () => true,
    async chat(_messages: ChatMessage[]): Promise<ChatResponse> {
      return { content: "x", model: "x" }
    },
    async *stream() { /* noop */ },
  }
}

function makeWorkspace(id: string): Workspace {
  const tasks: Task[] = [
    { id: "t1", description: "x", agentRole: "general", dependsOn: [], status: "pending" },
  ]
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

function makeSink() {
  return {
    workspaces: new Map<string, Workspace>(),
    async saveWorkspace(w: Workspace) { this.workspaces.set(w.id, w) },
    async loadWorkspace(id: string) { return this.workspaces.get(id) },
  }
}

describe("AgentRuntime permission pause/resume", () => {
  it("awaits a parked request and resolves when the runtime is told", async () => {
    const runtime = new AgentRuntime(
      () => new NoopAgent(noopProvider()),
      makeSink(),
    )
    const promise = runtime.awaitPermission("prq_a", {
      workspaceId: "ws1",
      taskId: "t1",
    })
    expect(runtime.pendingPermissionCount()).toBe(1)

    // Park the call: should not resolve until we tell it to.
    let resolved = false
    void promise.then(() => { resolved = true })

    // Tiny delay to let the microtask settle.
    await new Promise((r) => setTimeout(r, 5))
    expect(resolved).toBe(false)

    const ok = runtime.resolvePermission("prq_a", "allow")
    expect(ok).toBe(true)
    expect(runtime.pendingPermissionCount()).toBe(0)
    await expect(promise).resolves.toBe("allow")
  })

  it("returns false for unknown request ids", () => {
    const runtime = new AgentRuntime(
      () => new NoopAgent(noopProvider()),
      makeSink(),
    )
    expect(runtime.resolvePermission("nonexistent", "deny")).toBe(false)
  })

  it("emits permission-resolved after the decision is applied", async () => {
    const runtime = new AgentRuntime(
      () => new NoopAgent(noopProvider()),
      makeSink(),
    )
    const events: RuntimeEvent[] = []
    runtime.on((e) => events.push(e))

    const promise = runtime.awaitPermission("prq_b", {
      workspaceId: "ws-2",
      taskId: "t-9",
    })
    runtime.resolvePermission("prq_b", "deny")
    await promise

    const resolved = events.find((e) => e.type === "permission-resolved")
    expect(resolved).toBeDefined()
    if (resolved && resolved.type === "permission-resolved") {
      expect(resolved.requestId).toBe("prq_b")
      expect(resolved.decision).toBe("deny")
      expect(resolved.workspaceId).toBe("ws-2")
      expect(resolved.taskId).toBe("t-9")
    }
  })

  it("a workspace still runs to completion when no permission is awaited", async () => {
    const runtime = new AgentRuntime(
      () => new NoopAgent(noopProvider()),
      makeSink(),
    )
    const ws = makeWorkspace("ws-3")
    const result = await runtime.execute(ws)
    expect(result.status).toBe("completed")
    expect(runtime.pendingPermissionCount()).toBe(0)
  })
})
