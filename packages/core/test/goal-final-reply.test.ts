// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Goal final reply — the idle→working→final-reply→closed machine, the
 * exactly-once emission guarantee, and the runtime wiring into emitEvent.
 */
import { describe, expect, it } from "vitest"
import { AgentRuntime } from "../src/runtime.js"
import { Agent } from "../src/agent.js"
import {
  GOAL_REPLY_MAX_CHARS,
  NO_OUTPUT_REPLY,
  RESULT_TRUNCATED_NOTICE,
  GoalFinalReplyMachine,
  assembleGoalReply,
  canDriveGoalFinalReply,
  driveGoalFinalReply,
  normalizeReplyFingerprint,
} from "../src/goal-final-reply.js"
import { endsWithLoneHighSurrogate } from "../src/text-safe.js"
import type { AgentContext } from "../src/agent.js"
import type { Plan, Result, Task, Workspace } from "../src/types.js"

// ── Pure model ──────────────────────────────────────────────────────────────

describe("driveGoalFinalReply", () => {
  it("walks the full lifecycle and emits only on working → final-reply", () => {
    expect(driveGoalFinalReply("idle", "goal-started")).toEqual({
      accepted: true,
      emitFinalReply: false,
      state: "working",
    })
    expect(driveGoalFinalReply("working", "goal-reached")).toEqual({
      accepted: true,
      emitFinalReply: true,
      state: "final-reply",
    })
    expect(driveGoalFinalReply("final-reply", "reply-acked")).toEqual({
      accepted: true,
      emitFinalReply: false,
      state: "closed",
    })
    expect(driveGoalFinalReply("closed", "goal-started").state).toBe("working")
  })

  it("allows starting over from closed and cancelling without a reply", () => {
    expect(driveGoalFinalReply("closed", "goal-started")).toEqual({
      accepted: true,
      emitFinalReply: false,
      state: "working",
    })
    expect(driveGoalFinalReply("working", "goal-cancelled")).toEqual({
      accepted: true,
      emitFinalReply: false,
      state: "idle",
    })
    expect(driveGoalFinalReply("final-reply", "goal-cancelled")).toEqual({
      accepted: true,
      emitFinalReply: false,
      state: "idle",
    })
  })

  it("rejects invalid transitions without throwing and without moving", () => {
    const cases: Array<
      [Parameters<typeof driveGoalFinalReply>[0], Parameters<typeof driveGoalFinalReply>[1]]
    > = [
      ["idle", "goal-reached"],
      ["idle", "reply-acked"],
      ["working", "goal-started"],
      ["working", "reply-acked"],
      ["final-reply", "goal-reached"], // the exactly-once edge, second time
      ["closed", "goal-reached"],
      ["closed", "reply-acked"],
    ]
    for (const [state, event] of cases) {
      const drive = driveGoalFinalReply(state, event)
      expect(drive.accepted).toBe(false)
      expect(drive.emitFinalReply).toBe(false)
      expect(drive.state).toBe(state)
      expect(drive.reason).toMatch(new RegExp(`${state} --${event}`))
      expect(canDriveGoalFinalReply(state, event)).toBe(false)
    }
  })

  it("machine dispatch applies only accepted transitions", () => {
    const machine = new GoalFinalReplyMachine("goal-1")
    expect(machine.state).toBe("idle")
    machine.dispatch("goal-started")
    expect(machine.state).toBe("working")
    expect(machine.dispatch("goal-reached").emitFinalReply).toBe(true)
    expect(machine.state).toBe("final-reply")
    expect(machine.dispatch("goal-reached").emitFinalReply).toBe(false)
    expect(machine.state).toBe("final-reply")
    machine.dispatch("reply-acked")
    expect(machine.state).toBe("closed")
  })
})

describe("normalizeReplyFingerprint", () => {
  it("normalizes line endings and whitespace, hashes the semantic text", () => {
    const fp = normalizeReplyFingerprint("  done\r\nwith\r\nit  ")
    expect(fp).toBe(normalizeReplyFingerprint("done\nwith\nit"))
    expect(fp).toMatch(/^[0-9a-f]{64}$/)
    expect(normalizeReplyFingerprint("   \n\r\n")).toBeUndefined()
    expect(normalizeReplyFingerprint(undefined)).toBeUndefined()
    expect(normalizeReplyFingerprint("a")).not.toBe(normalizeReplyFingerprint("b"))
  })
})

describe("assembleGoalReply (MiniApps task-dispatcher borrowing)", () => {
  it("keeps the error-first invariant", () => {
    const out = assembleGoalReply({ error: new Error("boom"), output: "partial" })
    expect(out.reply).toBe("Error: boom")
    expect(out.truncated).toBe(false)
    expect(out.reply).not.toContain(RESULT_TRUNCATED_NOTICE)
  })

  it("clips a 4000+ char output to the reply budget and says so", () => {
    const long = "x".repeat(GOAL_REPLY_MAX_CHARS + 500)
    const out = assembleGoalReply({ output: long })
    expect(out.truncated).toBe(true)
    expect(out.shownChars).toBe(GOAL_REPLY_MAX_CHARS)
    expect(out.storedChars).toBe(long.length)
    expect(out.reply).toContain(RESULT_TRUNCATED_NOTICE)
    expect(out.reply).toContain(`showing ${GOAL_REPLY_MAX_CHARS} of ${long.length} chars`)
    expect(out.reply.startsWith("x".repeat(100))).toBe(true)
  })

  it("flags an already-truncated record even when the shown text is short", () => {
    const out = assembleGoalReply({
      output: "short answer",
      resultTruncated: true,
      storedChars: 9_000,
    })
    expect(out.truncated).toBe(true)
    expect(out.reply).toContain("short answer")
    expect(out.reply).toContain(RESULT_TRUNCATED_NOTICE)
    expect(out.reply).toContain("showing 12 of 9000 chars")
  })

  it("leaves an untruncated reply untouched", () => {
    const within = "y".repeat(GOAL_REPLY_MAX_CHARS)
    const out = assembleGoalReply({ output: within })
    expect(out.truncated).toBe(false)
    expect(out.reply).toBe(within)
    expect(out.reply).not.toContain(RESULT_TRUNCATED_NOTICE)
  })

  it("states that there was no output instead of returning an empty string", () => {
    expect(assembleGoalReply({}).reply).toBe(NO_OUTPUT_REPLY)
    expect(assembleGoalReply({ output: "" }).reply).toBe(NO_OUTPUT_REPLY)
    expect(assembleGoalReply({ output: undefined }).reply).toBe(NO_OUTPUT_REPLY)
  })

  it("never ends the clipped body on half a surrogate pair", () => {
    // 3999 BMP chars + U+1F600: the 4000-unit cut lands between the halves.
    const raw = "x".repeat(GOAL_REPLY_MAX_CHARS - 1) + "😀"
    const out = assembleGoalReply({ output: raw })
    expect(out.truncated).toBe(true)
    const body = out.reply.slice(0, out.reply.indexOf("\n" + RESULT_TRUNCATED_NOTICE))
    expect(body).toBe("x".repeat(GOAL_REPLY_MAX_CHARS - 1))
    expect(endsWithLoneHighSurrogate(body)).toBe(false)
    expect(endsWithLoneHighSurrogate(out.reply)).toBe(false)
  })
})

// ── Runtime wiring ──────────────────────────────────────────────────────────

class StubAgent extends Agent {
  readonly manifest = {
    role: "general" as const,
    systemPrompt: "stub",
    name: "stub",
    description: "stub",
    capabilities: [],
    model: { provider: "stub", name: "stub-1" },
  }
  constructor(private readonly output: string) {
    super({ id: "stub", name: "stub", defaultModel: "stub-1", isConfigured: () => true } as never)
  }
  async execute(task: Task, _ctx: AgentContext): Promise<Result> {
    return {
      id: `r-${task.id}`,
      taskId: task.id,
      agentRole: task.agentRole,
      output: this.output,
      metadata: { usage: { input: 1, output: 1 } },
    }
  }
}

function makeRuntime(output: string) {
  const saved = new Map<string, Workspace>()
  const runtime = new AgentRuntime(() => new StubAgent(output), {
    async saveWorkspace(w: Workspace) {
      saved.set(w.id, structuredClone(w))
    },
    async loadWorkspace(id: string) {
      return saved.get(id)
    },
  })
  return { runtime, saved }
}

function makeWorkspace(id: string): Workspace {
  const tasks: Task[] = [
    { id: "t1", agentRole: "general", description: "t", dependsOn: [], status: "pending" },
  ]
  const plan: Plan = {
    id: `plan-${id}`,
    workspaceId: id,
    userRequest: "x",
    rationale: "",
    tasks,
    createdAt: new Date().toISOString(),
  }
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

describe("AgentRuntime goal final reply", () => {
  it("emits exactly one goal-final-reply event per cycle", async () => {
    const { runtime } = makeRuntime("the answer")
    const finalReplies: Array<{ goalId: string; reply: string; fingerprint?: string }> = []
    const doneEvents: Array<{ type: string }> = []
    runtime.on((event) => {
      if (event.type === "goal-final-reply") {
        finalReplies.push({
          goalId: event.goalId,
          reply: event.reply,
          fingerprint: event.fingerprint,
        })
      } else if (event.type === "done") {
        doneEvents.push(event)
      }
    })

    runtime.declareGoal("ws", "goal-1")
    expect(runtime.goalFinalReplyState("ws")).toBe("working")

    // A natural completion auto-resolves the declared goal — the reply is
    // the newest result, emitted before the done event.
    await runtime.execute(makeWorkspace("ws"))
    expect(finalReplies).toEqual([
      {
        goalId: "goal-1",
        reply: "the answer",
        fingerprint: normalizeReplyFingerprint("the answer"),
      },
    ])
    expect(runtime.goalFinalReplyState("ws")).toBe("final-reply")
    expect(doneEvents).toHaveLength(1)

    // Duplicate terminal events cannot re-emit: re-resolve, and a full
    // re-execution of the workspace with more results, both stay silent.
    expect(runtime.resolveGoal("ws", "the answer")).toBe(false)
    await runtime.execute(makeWorkspace("ws"))
    expect(finalReplies).toHaveLength(1)
    expect(doneEvents).toHaveLength(2)

    // Ack → closed; a NEW goal cycle re-arms exactly one more reply.
    expect(runtime.acknowledgeGoalReply("ws")).toBe(true)
    expect(runtime.acknowledgeGoalReply("ws")).toBe(false)
    expect(runtime.goalFinalReplyState("ws")).toBe("closed")
    runtime.declareGoal("ws", "goal-2")
    expect(runtime.resolveGoal("ws", "second answer")).toBe(true)
    expect(finalReplies).toHaveLength(2)
    expect(finalReplies[1].goalId).toBe("goal-2")
  })

  it("annotates an over-budget final reply and tags the source result", async () => {
    const long = "z".repeat(GOAL_REPLY_MAX_CHARS + 250)
    const { runtime } = makeRuntime(long)
    const replies: Array<{
      type: string
      reply?: string
      truncated?: boolean
      shownChars?: number
      storedChars?: number
    }> = []
    let doneWorkspace: Workspace | undefined
    runtime.on((event) => {
      if (event.type === "goal-final-reply") {
        replies.push({
          type: event.type,
          reply: event.reply,
          truncated: event.truncated,
          shownChars: event.shownChars,
          storedChars: event.storedChars,
        })
      } else if (event.type === "done") {
        doneWorkspace = event.workspace
      }
    })

    runtime.declareGoal("ws", "g-long")
    await runtime.execute(makeWorkspace("ws"))

    expect(replies).toHaveLength(1)
    expect(replies[0]!.truncated).toBe(true)
    expect(replies[0]!.shownChars).toBe(GOAL_REPLY_MAX_CHARS)
    expect(replies[0]!.storedChars).toBe(long.length)
    expect(replies[0]!.reply).toContain(RESULT_TRUNCATED_NOTICE)

    // The done-event workspace carries the marker on the source Result so a
    // dashboard card can render a truncated badge without re-deriving it.
    const last = doneWorkspace!.results[doneWorkspace!.results.length - 1]!
    expect(last.metadata?.resultTruncated).toBe(true)
  })

  it("does not annotate an untruncated final reply", async () => {
    const { runtime } = makeRuntime("short answer")
    const replies: Array<{ truncated?: boolean }> = []
    runtime.on((event) => {
      if (event.type === "goal-final-reply") replies.push({ truncated: event.truncated })
    })
    runtime.declareGoal("ws", "g-short")
    await runtime.execute(makeWorkspace("ws"))
    expect(replies).toEqual([{ truncated: undefined }])
  })

  it("manual resolveGoal works and re-declaring a working goal is a no-op", () => {
    const { runtime } = makeRuntime("ok")
    const replies: string[] = []
    runtime.on((event) => {
      if (event.type === "goal-final-reply") replies.push(event.reply)
    })
    runtime.declareGoal("ws", "g1")
    runtime.declareGoal("ws", "g1") // no-op — same goal, still working
    expect(runtime.resolveGoal("ws", "done once")).toBe(true)
    expect(replies).toEqual(["done once"])
    // final-reply state: re-declaring the SAME id still re-arms (stale cycle).
    runtime.declareGoal("ws", "g1")
    expect(runtime.goalFinalReplyState("ws")).toBe("working")
    expect(runtime.resolveGoal("ws", "done twice")).toBe(true)
    expect(replies).toEqual(["done once", "done twice"])
  })

  it("aborting a workspace does not resolve its goal; cancelGoal abandons it", async () => {
    const { runtime } = makeRuntime("ok")
    runtime.declareGoal("ws", "g1")
    // Workspace with no plan fails before any task runs; the goal stays working.
    runtime.abort("ws", "user stop")
    expect(runtime.goalFinalReplyState("ws")).toBe("working")
    expect(runtime.resolveGoal("ws", "late")).toBe(true)

    runtime.declareGoal("ws2", "g2")
    expect(runtime.cancelGoal("ws2")).toBe(true)
    expect(runtime.goalFinalReplyState("ws2")).toBe("idle")
    expect(runtime.resolveGoal("ws2", "after cancel")).toBe(false)
  })

  it("resolveGoal without a declared goal is a no-op", () => {
    const { runtime } = makeRuntime("ok")
    expect(runtime.resolveGoal("undeclared", "reply")).toBe(false)
    expect(runtime.goalFinalReplyState("undeclared")).toBeUndefined()
    expect(runtime.acknowledgeGoalReply("undeclared")).toBe(false)
    expect(runtime.cancelGoal("undeclared")).toBe(false)
  })
})
