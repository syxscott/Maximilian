// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Stop suppression window — pure window model (injectable clock) and the
 * runtime gate: after an explicit stop, machinery-driven re-triggers of the
 * same workspace are refused until the window expires, while user-initiated
 * calls are never blocked.
 */
import { describe, expect, it } from "vitest"
import { AgentRuntime } from "../src/runtime.js"
import { Agent } from "../src/agent.js"
import {
  AutoResumeSuppressedError,
  DEFAULT_STOP_SUPPRESSION_WINDOW_MS,
  StopSuppressionWindow,
  suppressionVerdict,
} from "../src/stop-suppression.js"
import type { Result, Task, Workspace } from "../src/types.js"

// ── Pure model ──────────────────────────────────────────────────────────────

describe("suppressionVerdict", () => {
  it("is suppressed strictly within the window", () => {
    expect(suppressionVerdict(undefined, 1_000, 5_000)).toEqual({
      suppressed: false,
      remainingMs: 0,
    })
    expect(suppressionVerdict(1_000, 1_000, 5_000)).toEqual({
      suppressed: true,
      remainingMs: 5_000,
    })
    expect(suppressionVerdict(1_000, 5_999, 5_000)).toEqual({
      suppressed: true,
      remainingMs: 1,
    })
    // The window boundary itself expires the suppression.
    expect(suppressionVerdict(1_000, 6_000, 5_000)).toEqual({
      suppressed: false,
      remainingMs: 0,
    })
    // A stop recorded "in the future" (clock skew) is not suppressed forever.
    expect(suppressionVerdict(2_000, 1_000, 5_000)).toEqual({
      suppressed: false,
      remainingMs: 0,
    })
  })
})

describe("StopSuppressionWindow", () => {
  it("records, checks, and purges with an injectable clock", () => {
    let now = 10_000
    const clock = () => now
    const window = new StopSuppressionWindow({ windowMs: 500, now: clock })

    expect(window.check("ws-1")).toEqual({ suppressed: false, remainingMs: 0 })

    window.recordStop("ws-1", "user stop")
    expect(window.stopOf("ws-1")).toEqual({ stoppedAtMs: 10_000, reason: "user stop" })
    now = 10_200
    expect(window.check("ws-1")).toEqual({ suppressed: true, remainingMs: 300 })

    // A repeated stop restarts the window from the newest stop.
    now = 10_600
    window.recordStop("ws-1")
    now = 10_700
    expect(window.check("ws-1").suppressed).toBe(true)
    now = 11_100
    expect(window.check("ws-1").suppressed).toBe(false)

    // Keys are independent.
    expect(window.check("ws-2").suppressed).toBe(false)

    window.clear("ws-1")
    expect(window.check("ws-1").suppressed).toBe(false)
  })

  it("purges expired entries and keeps live ones", () => {
    let now = 0
    const window = new StopSuppressionWindow({ windowMs: 100, now: () => now })
    window.recordStop("a")
    now = 50
    window.recordStop("b")
    now = 120
    expect(window.purge()).toBe(1) // only "a" expired
    expect(window.size).toBe(1)
    now = 200
    expect(window.purge()).toBe(1)
    expect(window.size).toBe(0)
  })

  it("rejects a negative window", () => {
    expect(() => new StopSuppressionWindow({ windowMs: -1 })).toThrow(/windowMs/)
  })

  it("defaults to a 5s window", () => {
    expect(DEFAULT_STOP_SUPPRESSION_WINDOW_MS).toBe(5_000)
  })
})

// ── Runtime wiring ──────────────────────────────────────────────────────────

class InstantAgent extends Agent {
  readonly manifest = {
    role: "general" as const,
    systemPrompt: "stub",
    name: "instant",
    description: "finishes immediately",
    capabilities: [],
    model: { provider: "stub", name: "stub-1" },
  }
  constructor() {
    super({
      id: "instant",
      name: "instant",
      defaultModel: "stub-1",
      isConfigured: () => true,
    } as never)
  }
  async execute(task: Task): Promise<Result> {
    return {
      id: `r-${task.id}`,
      taskId: task.id,
      agentRole: task.agentRole,
      output: "ok",
      metadata: { usage: { input: 1, output: 1 } },
    }
  }
}

function makeRuntime(windowMs?: number) {
  const saved = new Map<string, Workspace>()
  return new AgentRuntime(
    () => new InstantAgent(),
    {
      async saveWorkspace(w: Workspace) {
        saved.set(w.id, structuredClone(w))
      },
      async loadWorkspace(id: string) {
        return saved.get(id)
      },
    },
    // Options are the THIRD constructor argument — not part of the sink.
    windowMs !== undefined ? { stopSuppressionWindowMs: windowMs } : undefined,
  )
}

function makeWorkspace(id: string): Workspace {
  return {
    id,
    userRequest: "x",
    plan: {
      id: `plan-${id}`,
      workspaceId: id,
      userRequest: "x",
      rationale: "",
      tasks: [
        {
          id: "t1",
          agentRole: "general",
          description: "t",
          dependsOn: [],
          status: "pending",
        },
      ],
      createdAt: new Date().toISOString(),
    },
    results: [],
    status: "pending",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

describe("AgentRuntime suppression gate", () => {
  it("suppresses an auto-resume right after an explicit stop, then expires", async () => {
    const runtime = makeRuntime(30)
    const ws = makeWorkspace("ws-gate")
    await runtime.execute(ws)

    runtime.abort("ws-gate", "user stop")
    expect(runtime.checkAutoResume("ws-gate")).toMatchObject({ suppressed: true })
    await expect(runtime.execute(ws, { autoResume: true })).rejects.toBeInstanceOf(
      AutoResumeSuppressedError,
    )

    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(runtime.checkAutoResume("ws-gate").suppressed).toBe(false)
    await expect(runtime.execute(ws, { autoResume: true })).resolves.toBeDefined()
  })

  it("never blocks user-initiated execution and unknown workspaces", async () => {
    const runtime = makeRuntime(60_000)
    runtime.abort("never-ran", "user stop")
    expect(runtime.checkAutoResume("never-ran").suppressed).toBe(true)
    expect(runtime.checkAutoResume("untouched").suppressed).toBe(false)
    // No autoResume flag → user-initiated → allowed even inside the window.
    await expect(runtime.execute(makeWorkspace("ws-user"))).resolves.toBeDefined()
  })
})
