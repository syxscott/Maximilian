// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Phase + PhaseRunner tests (借鉴 ChatDev ChatChain).
 */
import { describe, it, expect, beforeEach } from "vitest"
import {
  PhaseRunner,
  defaultGate,
  BUILT_IN_PHASES,
  type Phase,
  type PhaseContext,
  type PhaseVerdict,
  type PhaseResult,
} from "../src/phase.js"
import { EventBus } from "../src/event-bus.js"

type SimpleState = { counter: number }

function makeContext(): PhaseContext<SimpleState> {
  return {
    workspaceId: "ws-1",
    phaseId: "test",
    state: { counter: 0 },
    artifacts: [],
    messages: [],
    role: "test",
    startTime: new Date(),
  }
}

function countPhase(id: string, increment: number, gateVerdict?: PhaseVerdict): Phase<SimpleState> {
  return {
    id,
    name: `Count ${id}`,
    description: `Increment counter by ${increment}`,
    roles: ["test"],
    inputSchema: {},
    outputSchema: {},
    async run(ctx) {
      ctx.state.counter += increment
      return { incremented: increment }
    },
    async gate(ctx) {
      if (gateVerdict) return gateVerdict
      return ctx.state.counter >= 0 ? "pass" : "fail"
    },
  }
}

describe("PhaseRunner (借鉴 ChatDev ChatChain)", () => {
  let eventBus: EventBus<import("../src/phase.js").PhaseEvent>

  beforeEach(() => {
    eventBus = new EventBus()
  })

  it("run() executes all phases in order", async () => {
    const phases: Phase<SimpleState>[] = [
      countPhase("a", 1),
      countPhase("b", 2),
      countPhase("c", 3),
    ]
    const runner = new PhaseRunner(phases, makeContext(), eventBus)
    const results = await runner.run()

    expect(results).toHaveLength(3)
    expect(results[0]!.phaseId).toBe("a")
    expect(results[1]!.phaseId).toBe("b")
    expect(results[2]!.phaseId).toBe("c")
    // State accumulates: 0+1+2+3 = 6
    expect(results[2]!.finalState.counter).toBe(6)
  })

  it("runUntil() stops at the specified phase", async () => {
    const phases: Phase<SimpleState>[] = [
      countPhase("a", 1),
      countPhase("b", 2),
      countPhase("c", 3),
    ]
    const runner = new PhaseRunner(phases, makeContext(), eventBus)
    const results = await runner.runUntil("b")

    expect(results).toHaveLength(2)
    expect(results[0]!.phaseId).toBe("a")
    expect(results[1]!.phaseId).toBe("b")
    expect(runner.currentPhase()?.id).toBe("c")
  })

  it("run() throws when gate returns 'fail'", async () => {
    const phases: Phase<SimpleState>[] = [
      countPhase("a", 1),
      { ...countPhase("b", 2), gate: () => Promise.resolve("fail" as PhaseVerdict) },
      countPhase("c", 3),
    ]
    const runner = new PhaseRunner(phases, makeContext(), eventBus)
    await expect(runner.run()).rejects.toThrow("gate returned 'fail'")
  })

  it("run() stops when gate returns 'skip'", async () => {
    const phases: Phase<SimpleState>[] = [
      countPhase("a", 1),
      { ...countPhase("b", 2), gate: () => Promise.resolve("skip" as PhaseVerdict) },
      countPhase("c", 3),
    ]
    const runner = new PhaseRunner(phases, makeContext(), eventBus)
    const results = await runner.run()

    expect(results).toHaveLength(2)
    expect(results[1]!.verdict).toBe("skip")
  })

  it("run() records verdict 'pass' when no gate defined", async () => {
    const phases: Phase<SimpleState>[] = [
      { ...countPhase("a", 1), gate: undefined },
    ]
    const runner = new PhaseRunner(phases, makeContext(), eventBus)
    const results = await runner.run()
    expect(results[0]!.verdict).toBe("pass")
  })

  it("run() throws and records phaseError when a phase's run() throws", async () => {
    // The runner surfaces uncaught phase exceptions as a thrown error so
    // callers can decide whether to abort, retry, or record-and-continue.
    // The thrown message includes the phase id and the original cause.
    const phases: Phase<SimpleState>[] = [
      {
        id: "throwing",
        name: "Throwing",
        description: "Throws",
        roles: [],
        inputSchema: {},
        outputSchema: {},
        async run() { throw new Error("boom") },
        gate: () => Promise.resolve("pass" as PhaseVerdict),
      },
    ]
    const runner = new PhaseRunner(phases, makeContext(), eventBus)
    await expect(runner.run()).rejects.toThrow(/throwing.*boom|boom/)
  })

  it("emits phase:start and phase:end events", async () => {
    const phases: Phase<SimpleState>[] = [countPhase("a", 1)]
    const runner = new PhaseRunner(phases, makeContext(), eventBus)
    const events: import("../src/phase.js").PhaseEvent[] = []
    eventBus.subscribe((e) => events.push(e))
    await runner.run()

    // PhaseEvent includes workspaceId so a downstream subscriber can route
    // the event to the right workspace stream. Earlier versions of this
    // test asserted only { type, phaseId, turn }, which silently broke
    // when workspaceId was added to the wire shape — `toContainEqual`
    // requires strict field-by-field equality.
    expect(events).toContainEqual(expect.objectContaining({ type: "phase:start", workspaceId: "ws-1", phaseId: "a", turn: 0 }))
    expect(events).toContainEqual(expect.objectContaining({ type: "phase:end", workspaceId: "ws-1", phaseId: "a", verdict: "pass" }))
  })

  it("currentPhase() returns null before run()", () => {
    const phases: Phase<SimpleState>[] = [countPhase("a", 1)]
    const runner = new PhaseRunner(phases, makeContext(), eventBus)
    expect(runner.currentPhase()).toBeNull()
  })

  it("getHistory() returns results in order", async () => {
    const phases: Phase<SimpleState>[] = [countPhase("a", 1), countPhase("b", 2)]
    const runner = new PhaseRunner(phases, makeContext(), eventBus)
    await runner.run()
    expect(runner.getHistory()).toHaveLength(2)
  })
})

describe("defaultGate", () => {
  it("always returns 'pass'", async () => {
    const verdict = await defaultGate(makeContext())
    expect(verdict).toBe("pass")
  })
})

describe("BUILT_IN_PHASES", () => {
  it("exports all expected phase IDs", () => {
    expect(BUILT_IN_PHASES.INTAKE).toBe("intake")
    expect(BUILT_IN_PHASES.PLAN).toBe("plan")
    expect(BUILT_IN_PHASES.IMPLEMENT).toBe("implement")
    expect(BUILT_IN_PHASES.REVIEW).toBe("review")
    expect(BUILT_IN_PHASES.FINALIZE).toBe("finalize")
  })
})
