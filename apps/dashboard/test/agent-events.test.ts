// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Tests for the live-agent event derivations (trajectory / subagent
 * runs / file changes) that power the three ZCode-borrowed panels.
 */
import { describe, it, expect } from "vitest"
import {
  deriveTrajectory,
  deriveAgentRuns,
  deriveFileChanges,
} from "../src/lib/agent-events"
import type { RuntimeEvent } from "../src/api"

const ev = (over: Record<string, unknown>): RuntimeEvent =>
  ({ workspaceId: "ws1", ...over }) as RuntimeEvent

describe("deriveTrajectory", () => {
  it("keeps decision-relevant events in order and drops noise", () => {
    const events = [
      ev({ type: "task-start", taskId: "t1", agentRole: "backend" }),
      ev({ type: "ledger", workspaceId: "ws1" }), // noise
      ev({ type: "tool-start", taskId: "t1", toolName: "edit" }),
      ev({ type: "tool-end", taskId: "t1", toolName: "edit", ok: true, durationMs: 12 }),
      ev({
        type: "llm-retry-status",
        taskId: "t1",
        phase: "waiting",
        attempt: 2,
        maxAttempts: 3,
        delayMs: 1500,
      }),
      ev({ type: "task-complete", taskId: "t1" }),
    ]
    const traj = deriveTrajectory(events)
    expect(traj.map((t) => t.event)).toEqual([
      "task-start",
      "tool-start",
      "tool-end",
      "llm-retry-status",
      "task-complete",
    ])
    expect(traj[3]?.detail).toContain("2/3")
    expect(traj[3]?.detail).toContain("1500ms")
  })

  it("filters by taskId when one is given", () => {
    const events = [
      ev({ type: "task-start", taskId: "t1", agentRole: "backend" }),
      ev({ type: "task-start", taskId: "t2", agentRole: "frontend" }),
      ev({ type: "tool-end", taskId: "t1", toolName: "edit", ok: false, durationMs: 1 }),
    ]
    expect(deriveTrajectory(events, "t1").map((t) => t.event)).toEqual([
      "task-start",
      "tool-end",
    ])
    expect(deriveTrajectory(events)).toHaveLength(3)
  })

  it("marks failed tools/tasks and tolerates malformed events", () => {
    const events = [
      ev({ type: "task-failed", taskId: "t1", error: "boom" }),
      ev({ type: "tool-end", taskId: "t1", toolName: "bash", ok: false, durationMs: 5, error: "denied" }),
      ev({ type: "llm-retry-status", taskId: "t1", phase: "exhausted", attempt: 3 }),
    ]
    const traj = deriveTrajectory(events)
    expect(traj.filter((t) => t.ok === false)).toHaveLength(3)
  })
})

describe("deriveAgentRuns", () => {
  it("collapses the stream into one live row per task", () => {
    const events = [
      ev({ type: "task-start", taskId: "t1", agentRole: "backend" }),
      ev({ type: "tool-end", taskId: "t1", toolName: "read", ok: true }),
      ev({ type: "permission-request", taskId: "t1", tool: "bash", target: "/x" }),
      ev({ type: "steering-applied", workspaceId: "ws1", messages: [{}], taskIds: ["t1"] }),
      ev({ type: "task-start", taskId: "t2", agentRole: "frontend" }),
      ev({ type: "task-failed", taskId: "t2" }),
      ev({ type: "task-complete", taskId: "t3" }),
    ]
    const runs = deriveAgentRuns(events)
    expect(runs.size).toBe(3)
    const t1 = runs.get("t1")!
    expect(t1.state).toBe("running")
    expect(t1.lastTool).toEqual({ name: "read", ok: true })
    expect(t1.permissionPending).toBe(true)
    expect(t1.steeringCount).toBe(1)
    expect(runs.get("t2")!.state).toBe("failed")
    expect(runs.get("t3")!.state).toBe("completed")
  })
})

describe("deriveFileChanges", () => {
  it("keeps only edit/write tool calls with their inputs", () => {
    const events = [
      ev({ type: "tool-start", taskId: "t1", toolName: "read", input: { file_path: "/a" } }),
      ev({
        type: "tool-start",
        taskId: "t1",
        toolName: "edit",
        input: { file_path: "/src/x.ts", oldString: "a", newString: "b" },
      }),
      ev({
        type: "tool-start",
        taskId: "t2",
        toolName: "write",
        input: { file_path: "/new.ts", content: "hello" },
      }),
      ev({ type: "tool-end", taskId: "t1", toolName: "edit", ok: true, durationMs: 3 }),
    ]
    const changes = deriveFileChanges(events)
    expect(changes).toHaveLength(2)
    expect(changes.map((c) => c.tool)).toEqual(["edit", "write"])
    expect(changes[0]?.input).toHaveProperty("oldString")
  })
})
