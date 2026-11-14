// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT

/**
 * Park-state tracking tests (borrowing; OpenAgentCore
 * services/core/internal/execution/worker.go:277 + delivery.go:349).
 *
 * Covers the runtime side of the worker's park-yield: the
 * `onParkStateChange` hook fires on the running→parked and parked→running
 * edges of every parked human-decision promise (permission ask, approval
 * prompt), `isWorkspaceParked` reports the live state, and a prompt that
 * auto-resolves within the same microtask batch (PermissionService
 * always-rule) never reports parked at all.
 */
import { describe, it, expect } from "vitest"
import { AgentRuntime, type RuntimeEvent } from "../src/runtime.js"
import type { Plan, Task, Workspace } from "../src/types.js"

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

function makeWorkspace(id: string): Workspace {
  const task: Task = {
    id: "task-1",
    agentRole: "general",
    description: "do work",
    status: "pending",
    dependsOn: [],
  }
  const plan: Plan = {
    id: `plan-${id}`,
    workspaceId: id,
    userRequest: "build feature",
    rationale: "park test",
    tasks: [task],
    createdAt: new Date().toISOString(),
  }
  return {
    id,
    userRequest: "build feature",
    status: "planning",
    plan,
    results: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    metadata: {},
  }
}

/** Flush microtasks + timers so edge-triggered hook fires have landed. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 5))

describe("AgentRuntime park-state tracking (borrowing)", () => {
  it("reports parked/unparked edges around a parked permission ask", async () => {
    const transitions: Array<{ workspaceId: string; parked: boolean }> = []
    const runtime = new AgentRuntime(() => undefined, makeSink(), {
      onParkStateChange: (info) => transitions.push({ ...info }),
    })
    const meta = { workspaceId: "ws-1", taskId: "task-1", tool: "bash", target: "ls" }

    const ask = runtime.awaitPermission("req-1", meta)
    await settle()
    expect(transitions).toEqual([{ workspaceId: "ws-1", parked: true }])
    expect(runtime.isWorkspaceParked("ws-1")).toBe(true)

    expect(runtime.resolvePermission("req-1", "allow")).toBe(true)
    expect(await ask).toBe("allow")
    await settle()
    expect(transitions).toEqual([
      { workspaceId: "ws-1", parked: true },
      { workspaceId: "ws-1", parked: false },
    ])
    expect(runtime.isWorkspaceParked("ws-1")).toBe(false)
  })

  it("reports parked/unparked edges around a parked approval prompt", async () => {
    const transitions: Array<{ workspaceId: string; parked: boolean }> = []
    const runtime = new AgentRuntime(() => undefined, makeSink(), {
      onParkStateChange: (info) => transitions.push({ ...info }),
    })

    const ask = runtime.awaitApproval("appr-1", {
      workspaceId: "ws-2",
      taskId: "task-1",
      prompt: "approve release",
      requireComment: false,
    })
    await settle()
    expect(runtime.isWorkspaceParked("ws-2")).toBe(true)

    expect(runtime.resolveApproval("appr-1", { decision: "approve" }).ok).toBe(true)
    await ask
    await settle()
    expect(transitions).toEqual([
      { workspaceId: "ws-2", parked: true },
      { workspaceId: "ws-2", parked: false },
    ])
  })

  it("does not report parked when the ask auto-resolves via an always rule", async () => {
    const transitions: Array<{ workspaceId: string; parked: boolean }> = []
    const runtime = new AgentRuntime(() => undefined, makeSink(), {
      onParkStateChange: (info) => transitions.push({ ...info }),
    })
    const meta = { workspaceId: "ws-3", taskId: "task-1", tool: "bash", target: "npm test" }

    // First ask parks; the "allow-always" answer stores the pattern rule.
    // (The race maps the answer to "allow" — the always-rule bookkeeping
    // happens in service.answer, not in the resolved value.)
    const first = runtime.awaitPermission("req-1", meta)
    await settle()
    expect(runtime.isWorkspaceParked("ws-3")).toBe(true)
    runtime.resolvePermission("req-1", "allow-always")
    expect(await first).toBe("allow")
    await settle()

    // Second ask with the same target auto-approves inside the
    // PermissionService — the race settles before the parked-edge check
    // runs, so no transition may be reported for it.
    const second = runtime.awaitPermission("req-2", meta)
    expect(await second).toBe("allow")
    await settle()
    expect(transitions).toEqual([
      { workspaceId: "ws-3", parked: true },
      { workspaceId: "ws-3", parked: false },
    ])
  })

  it("reports the unpark edge when an aborted run rejects the parked prompt", async () => {
    const transitions: Array<{ workspaceId: string; parked: boolean }> = []
    const runtime = new AgentRuntime(() => undefined, makeSink(), {
      onParkStateChange: (info) => transitions.push({ ...info }),
    })
    const meta = { workspaceId: "ws-4", taskId: "task-1", tool: "bash", target: "ls" }

    const ask = runtime.awaitPermission("req-1", meta)
    await settle()
    expect(runtime.isWorkspaceParked("ws-4")).toBe(true)

    runtime.abort("ws-4", "user stop")
    expect(await ask).toBe("deny")
    await settle()
    expect(transitions).toEqual([
      { workspaceId: "ws-4", parked: true },
      { workspaceId: "ws-4", parked: false },
    ])
    expect(runtime.isWorkspaceParked("ws-4")).toBe(false)
  })

  it("without the hook option, parked prompts behave exactly as before", async () => {
    const runtime = new AgentRuntime(() => undefined, makeSink())
    const events: RuntimeEvent[] = []
    runtime.on((event) => events.push(event))
    const meta = { workspaceId: "ws-5", taskId: "task-1", tool: "bash", target: "ls" }

    const ask = runtime.awaitPermission("req-1", meta)
    await settle()
    expect(runtime.isWorkspaceParked("ws-5")).toBe(true)
    runtime.resolvePermission("req-1", "deny")
    expect(await ask).toBe("deny")
    expect(events.some((event) => event.type === "permission-resolved")).toBe(true)
  })
})
