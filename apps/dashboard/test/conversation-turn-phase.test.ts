// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Turn-phase machine tests (opencode session-ui turn-phase-machine
 * borrowing): the transition table over started/step/idle.failed, the
 * viewTurnPhase affordance derivation (live locks Copy, settled keeps
 * the last text, retrying carries attempt/next), phase equality, and
 * the compiled-turn adapter fold (turnPhaseOfTurn).
 */
import { describe, expect, it } from "vitest"
import {
  IDLE_TURN_PHASE,
  sameTurnPhase,
  transitionTurnPhase,
  turnPhaseOfTurn,
  viewTurnPhase,
  WORKING_TURN_PHASE,
  type TurnPhase,
  type TurnPhaseEvent,
} from "../src/components/conversation/turn-phase"
import {
  buildTurnFlowItems,
  groupUnitsByTurn,
  type RuntimeEvent,
} from "../src/components/conversation/model"

const ev = (over: Record<string, unknown>): RuntimeEvent =>
  ({ type: "unknown", ...over }) as RuntimeEvent

const step = (over: Partial<Extract<TurnPhaseEvent, { type: "step" }>>): TurnPhaseEvent => ({
  type: "step",
  active: true,
  session: "busy",
  completed: false,
  ...over,
})

describe("transitionTurnPhase (table-driven)", () => {
  const table: Array<{
    name: string
    from: TurnPhase
    event: TurnPhaseEvent
    to: TurnPhase
  }> = [
    {
      name: "started live → working",
      from: IDLE_TURN_PHASE,
      event: { type: "started", live: true },
      to: WORKING_TURN_PHASE,
    },
    {
      name: "started not-live → idle",
      from: IDLE_TURN_PHASE,
      event: { type: "started", live: false },
      to: IDLE_TURN_PHASE,
    },
    {
      name: "an inactive step settles to idle",
      from: WORKING_TURN_PHASE,
      event: step({ active: false, session: "idle", completed: true }),
      to: IDLE_TURN_PHASE,
    },
    {
      name: "a busy step from idle → working",
      from: IDLE_TURN_PHASE,
      event: step({}),
      to: WORKING_TURN_PHASE,
    },
    {
      name: "busy steps keep working",
      from: WORKING_TURN_PHASE,
      event: step({}),
      to: WORKING_TURN_PHASE,
    },
    {
      name: "a session idle step ends the live phase",
      from: WORKING_TURN_PHASE,
      event: step({ session: "idle" }),
      to: IDLE_TURN_PHASE,
    },
    {
      name: "a retry step → retrying with attempt/message/next",
      from: WORKING_TURN_PHASE,
      event: step({ session: "retry", retry: { attempt: 2, message: "rate limited", next: 3 } }),
      to: { status: "retrying", attempt: 2, message: "rate limited", next: 3 },
    },
    {
      name: "an interrupted error ends the live phase",
      from: WORKING_TURN_PHASE,
      event: step({ error: { interrupted: true } }),
      to: { status: "interrupted" },
    },
    {
      name: "a non-interrupted error → failed with the error info",
      from: WORKING_TURN_PHASE,
      event: step({ error: { interrupted: false, info: { text: "boom" } } }),
      to: { status: "failed", error: { text: "boom" } },
    },
    {
      name: "idle.failed → failed",
      from: IDLE_TURN_PHASE,
      event: { type: "idle.failed", error: { text: "cannot start" } },
      to: { status: "failed", error: { text: "cannot start" } },
    },
    {
      name: "a completed step mid-busy keeps working (settling comes from active/idle)",
      from: WORKING_TURN_PHASE,
      event: step({ completed: true, session: "busy" }),
      to: WORKING_TURN_PHASE,
    },
  ]

  it.each(table.map((row) => [row.name, row]))("%s", (_name, { from, event, to }) => {
    expect(transitionTurnPhase(from, event)).toEqual(to)
  })

  it("a reasoning step enters thinking with the part ref", () => {
    const next = transitionTurnPhase(
      WORKING_TURN_PHASE,
      step({
        reasoning: { ref: "m1:p1", placement: "separate" },
      }),
    )
    expect(next).toEqual({ status: "thinking", ref: "m1:p1", placement: "separate" })
  })

  it("a steady thinking step returns the SAME object (identity stability)", () => {
    const thinking: TurnPhase = { status: "thinking", ref: "m1:p1", placement: "grouped" }
    expect(
      transitionTurnPhase(thinking, step({ reasoning: { ref: "m1:p1", placement: "grouped" } })),
    ).toBe(thinking)
  })

  it("a reasoning step over a hidden placement is ignored (stays working)", () => {
    expect(
      transitionTurnPhase(
        WORKING_TURN_PHASE,
        step({
          reasoning: { ref: "m1:p1", placement: "hidden" },
        }),
      ),
    ).toBe(WORKING_TURN_PHASE)
  })

  it("a changed ref re-issues the thinking phase", () => {
    const thinking: TurnPhase = { status: "thinking", ref: "m1:p1", placement: "separate" }
    const next = transitionTurnPhase(
      thinking,
      step({
        reasoning: { ref: "m2:p1", placement: "separate" },
      }),
    )
    expect(next).toEqual({ status: "thinking", ref: "m2:p1", placement: "separate" })
    expect(next).not.toBe(thinking)
  })
})

describe("viewTurnPhase (affordance derivation)", () => {
  it.each([
    ["idle", { live: false, settled: true, hideCopy: false }],
    ["working", { live: true, settled: false, hideCopy: true }],
    ["thinking", { live: true, settled: false, hideCopy: true }],
    ["retrying", { live: false, settled: false, hideCopy: true }],
    ["failed", { live: false, settled: true, hideCopy: false }],
    ["interrupted", { live: false, settled: true, hideCopy: false }],
  ] as const)("%s → live/settled/hideCopy per the contract", (status, expected) => {
    const phase: TurnPhase =
      status === "retrying"
        ? { status: "retrying", attempt: 1, message: "m", next: 2 }
        : status === "failed"
          ? { status: "failed", error: { text: "x" } }
          : ({ status } as TurnPhase)
    const view = viewTurnPhase(phase)
    expect(view.live).toBe(expected.live)
    expect(view.settled).toBe(expected.settled)
    expect(view.hideCopy).toBe(expected.hideCopy)
  })

  it("surfaces the retry badge inputs (attempt/next) only while retrying", () => {
    expect(viewTurnPhase(IDLE_TURN_PHASE).retry).toBeUndefined()
    const retry = viewTurnPhase({ status: "retrying", attempt: 2, message: "rate", next: 3 }).retry
    expect(retry).toEqual({ status: "retrying", attempt: 2, message: "rate", next: 3 })
  })

  it("surfaces the error only while failed", () => {
    expect(viewTurnPhase(WORKING_TURN_PHASE).error).toBeUndefined()
    expect(viewTurnPhase({ status: "failed", error: { text: "boom" } }).error).toEqual({
      text: "boom",
    })
  })

  it("exposes the separate-thinking ref only for separate placement", () => {
    const grouped = viewTurnPhase({ status: "thinking", ref: "r1", placement: "grouped" })
    expect(grouped.separateThinkingRef).toBeUndefined()
    expect(grouped.streamingReasoningRef).toBe("r1")
    const separate = viewTurnPhase({ status: "thinking", ref: "r1", placement: "separate" })
    expect(separate.separateThinkingRef).toBe("r1")
  })
})

describe("sameTurnPhase", () => {
  it.each([
    [IDLE_TURN_PHASE, IDLE_TURN_PHASE, true],
    [WORKING_TURN_PHASE, IDLE_TURN_PHASE, false],
    [
      { status: "thinking", ref: "r1", placement: "separate" } as TurnPhase,
      { status: "thinking", ref: "r1", placement: "separate" } as TurnPhase,
      true,
    ],
    [
      { status: "thinking", ref: "r1", placement: "separate" } as TurnPhase,
      { status: "thinking", ref: "r1", placement: "grouped" } as TurnPhase,
      false,
    ],
    [
      { status: "retrying", attempt: 1, message: "m", next: 2 } as TurnPhase,
      { status: "retrying", attempt: 1, message: "m", next: 2 } as TurnPhase,
      true,
    ],
    [
      { status: "retrying", attempt: 1, message: "m", next: 2 } as TurnPhase,
      { status: "retrying", attempt: 2, message: "m", next: 3 } as TurnPhase,
      false,
    ],
    [
      { status: "failed", error: { text: "a" } } as TurnPhase,
      { status: "failed", error: { text: "a" } } as TurnPhase,
      true,
    ],
    [
      { status: "failed", error: { text: "a" } } as TurnPhase,
      { status: "failed", error: { text: "b" } } as TurnPhase,
      false,
    ],
    [{ status: "interrupted" } as TurnPhase, { status: "interrupted" } as TurnPhase, true],
  ])("sameTurnPhase rows", (a, b, expected) => {
    expect(sameTurnPhase(a, b)).toBe(expected)
  })
})

describe("turnPhaseOfTurn (the compiled-turn adapter fold)", () => {
  const turnOf = (events: RuntimeEvent[]) => {
    const [turn] = groupUnitsByTurn(buildTurnFlowItems(events, null))
    if (!turn) throw new Error("expected a turn")
    return turn
  }

  it("message turns (no task lifecycle) fold to idle", () => {
    const view = viewTurnPhase(
      turnPhaseOfTurn(turnOf([ev({ type: "assistant-text", text: "hi" })])),
    )
    expect(view.live).toBe(false)
    expect(view.settled).toBe(true)
    expect(view.hideCopy).toBe(false)
  })

  it("a running task turn with tools → working; Copy locked; not settled", () => {
    const phase = turnPhaseOfTurn(
      turnOf([
        ev({ type: "task-start", taskId: "t1" }),
        ev({ type: "tool-start", taskId: "t1", toolName: "bash" }),
      ]),
    )
    expect(phase.status).toBe("working")
    const view = viewTurnPhase(phase)
    expect(view.hideCopy).toBe(true)
    expect(view.settled).toBe(false)
  })

  it("a running task turn with a retry wave → retrying with attempt/next", () => {
    const phase = turnPhaseOfTurn(
      turnOf([
        ev({ type: "task-start", taskId: "t1" }),
        ev({
          type: "llm-retry-status",
          phase: "waiting",
          attempt: 2,
          maxAttempts: 5,
          delayMs: 100,
        }),
      ]),
    )
    expect(phase.status).toBe("retrying")
    const view = viewTurnPhase(phase)
    expect(view.retry).toMatchObject({ attempt: 2, next: 3 })
    expect(view.hideCopy).toBe(true)
  })

  it("the next attempt caps at maxAttempts", () => {
    const phase = turnPhaseOfTurn(
      turnOf([
        ev({ type: "task-start", taskId: "t1" }),
        ev({
          type: "llm-retry-status",
          phase: "waiting",
          attempt: 5,
          maxAttempts: 5,
          delayMs: 100,
        }),
      ]),
    )
    expect(phase.status).toBe("retrying")
    expect(viewTurnPhase(phase).retry).toMatchObject({ attempt: 5, next: 5 })
  })

  it("a completed task folds back to idle; a failed one to failed with the error", () => {
    const completed = turnPhaseOfTurn(
      turnOf([
        ev({ type: "task-start", taskId: "t1" }),
        ev({ type: "task-complete", taskId: "t1" }),
      ]),
    )
    expect(completed.status).toBe("idle")

    const failed = turnPhaseOfTurn(
      turnOf([
        ev({ type: "task-start", taskId: "t1" }),
        ev({ type: "task-failed", taskId: "t1", error: "step blew up" }),
      ]),
    )
    expect(failed).toEqual({ status: "failed", error: { text: "step blew up" } })
    expect(viewTurnPhase(failed).settled).toBe(true)
  })

  it("a trailing failed unit (the workspace-verdict unit shape) folds through idle.failed", () => {
    const events: RuntimeEvent[] = [ev({ type: "task-start", taskId: "t1" })]
    const turns = groupUnitsByTurn(buildTurnFlowItems(events, null))
    // The workspace verdict trails as its own `failed` unit; appended to
    // a task turn here so the fold exercises the idle.failed path.
    const withFailure = {
      ...turns[0]!,
      status: "running" as const,
      units: [
        ...turns[0]!.units,
        {
          kind: "failed",
          key: "failed-workspace",
          turnId: "workspace",
          role: "system",
          index: 1,
          error: "workspace exploded",
        },
      ],
    }
    const phase = turnPhaseOfTurn(withFailure)
    expect(phase).toEqual({ status: "failed", error: { text: "workspace exploded" } })
  })

  it("is defensive against malformed turns", () => {
    expect(turnPhaseOfTurn(null)).toEqual({ status: "idle" })
    expect(turnPhaseOfTurn(undefined)).toEqual({ status: "idle" })
  })
})
