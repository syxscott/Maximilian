// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Turn-phase state machine — where ONE turn stands in its lifecycle
 * (borrowing: opencode session-ui timeline/turn-phase-machine). Pure
 * transition + a view-derivation the header affordances render from.
 *
 * Phases: `working` = the model runs (between steps too); `thinking` =
 * working with visible reasoning still streaming; `retrying`, `failed`
 * and `interrupted` end the live phase even while the surrounding run
 * has not settled yet; `idle` = settled.
 *
 * The consumer (TurnGroup's header) derives the phase from its compiled
 * turn via turnPhaseOfTurn — a fold of the machine over per-unit step
 * events — and reads viewTurnPhase for the affordances: a live phase
 * locks Copy (the text is still changing), a settled phase keeps the
 * last text as the answer, and a retrying phase renders its
 * attempt/next badge.
 */

import type { ConversationUnit, TurnModel } from "./model"

/** Where reasoning streams — "hidden" never becomes a thinking phase. */
export type TurnThinkingPlacement = "separate" | "grouped" | "hidden"

/** Placement a materialized thinking phase can carry (never "hidden"). */
export type ThinkingPhasePlacement = Exclude<TurnThinkingPlacement, "hidden">

export interface TurnPhaseError {
  readonly text: string
  readonly kind?: string
  readonly resetAt?: number
}

export type TurnPhase =
  | { readonly status: "idle" }
  | { readonly status: "working" }
  | {
      readonly status: "thinking"
      readonly ref: string
      readonly placement: ThinkingPhasePlacement
    }
  | {
      readonly status: "retrying"
      readonly attempt: number
      readonly message: string
      readonly next: number
    }
  | { readonly status: "failed"; readonly error: TurnPhaseError }
  | { readonly status: "interrupted" }

/** The facts of one turn in order: whether it can run, then each step it took. */
export type TurnPhaseEvent =
  | { readonly type: "started"; readonly live: boolean }
  | {
      readonly type: "step"
      readonly active: boolean
      readonly session: "idle" | "busy" | "retry"
      readonly completed: boolean
      readonly reasoning?: { readonly ref: string; readonly placement: TurnThinkingPlacement }
      readonly retry?: { readonly attempt: number; readonly message: string; readonly next: number }
      readonly error?:
        | { readonly interrupted: true }
        | { readonly interrupted: false; readonly info: TurnPhaseError }
    }
  | { readonly type: "idle.failed"; readonly error: TurnPhaseError }

export const IDLE_TURN_PHASE: TurnPhase = Object.freeze({ status: "idle" })
export const WORKING_TURN_PHASE: TurnPhase = Object.freeze({ status: "working" })
export const INTERRUPTED_TURN_PHASE: TurnPhase = Object.freeze({ status: "interrupted" })

/**
 * One transition. Returns the SAME state object when nothing changes
 * (a steady scroll of steps writes no new identity), so downstream
 * memo layers stay stable across streaming frames.
 */
export function transitionTurnPhase(state: TurnPhase, event: TurnPhaseEvent): TurnPhase {
  if (event.type === "started") return event.live ? WORKING_TURN_PHASE : IDLE_TURN_PHASE

  if (event.type === "idle.failed") return { status: "failed", error: event.error }

  if (event.active && event.retry) return { status: "retrying", ...event.retry }

  if (event.error) {
    return event.error.interrupted
      ? INTERRUPTED_TURN_PHASE
      : { status: "failed", error: event.error.info }
  }

  if (!event.active || event.session === "idle") return IDLE_TURN_PHASE

  if (
    event.session === "busy" &&
    !event.completed &&
    event.reasoning &&
    event.reasoning.placement !== "hidden"
  ) {
    return state.status === "thinking" &&
      state.placement === event.reasoning.placement &&
      state.ref === event.reasoning.ref
      ? state
      : { status: "thinking", ref: event.reasoning.ref, placement: event.reasoning.placement }
  }

  return WORKING_TURN_PHASE
}

/**
 * The affordances a phase view renders from: `live` content is still
 * changing (Copy locked), settled phases keep their last text as the
 * answer, and a retry carries the attempt/next pair its badge shows.
 */
export function viewTurnPhase(state: TurnPhase) {
  const live = state.status === "working" || state.status === "thinking"

  return {
    /** The model is producing this turn, so its content is still changing. */
    live,
    /** Settled turns keep their last text as the answer. */
    settled: state.status === "idle" || state.status === "failed" || state.status === "interrupted",
    /** The reply is not final yet, so it offers no Copy. */
    hideCopy: live || state.status === "retrying",
    separateThinkingRef:
      state.status === "thinking" && state.placement === "separate" ? state.ref : undefined,
    streamingReasoningRef: state.status === "thinking" ? state.ref : undefined,
    retry: state.status === "retrying" ? state : undefined,
    error: state.status === "failed" ? state.error : undefined,
  }
}

export function sameTurnPhase(a: TurnPhase, b: TurnPhase): boolean {
  if (a === b) return true
  if (a.status !== b.status) return false
  if (a.status === "thinking") {
    const other = b as Extract<TurnPhase, { status: "thinking" }>
    return a.placement === other.placement && a.ref === other.ref
  }
  if (a.status === "retrying") {
    const other = b as Extract<TurnPhase, { status: "retrying" }>
    return a.attempt === other.attempt && a.message === other.message && a.next === other.next
  }
  if (a.status === "failed") {
    const other = b as Extract<TurnPhase, { status: "failed" }>
    return (
      a.error.text === other.error.text &&
      a.error.kind === other.error.kind &&
      a.error.resetAt === other.error.resetAt
    )
  }
  return true
}

// ── Compiled-turn adapter (the timeline's event source) ─────────────────────

function retryStepOf(unit: Extract<ConversationUnit, { kind: "retry" }>): TurnPhaseEvent {
  const attempt = typeof unit.attempt === "number" ? unit.attempt : unit.attempts
  const max = typeof unit.maxAttempts === "number" ? unit.maxAttempts : undefined
  const next = max !== undefined ? Math.min(attempt + 1, max) : attempt + 1
  return {
    type: "step",
    active: true,
    session: "retry",
    completed: false,
    retry: { attempt, message: unit.reason ?? "", next },
  }
}

function taskStatusStepOf(
  unit: Extract<ConversationUnit, { kind: "task-status" }>,
): TurnPhaseEvent {
  if (unit.status === "failed") {
    return {
      type: "step",
      active: false,
      session: "idle",
      completed: true,
      error: { interrupted: false, info: { text: unit.error ?? "task failed" } },
    }
  }
  return { type: "step", active: false, session: "idle", completed: true }
}

/**
 * The phase of one COMPILED turn: the machine folded over the turn's
 * unit stream — started (live for task turns), one step event per
 * unit (tool/text steps keep it working, a retry wave makes it
 * retrying, a task-status closes/fails it), and a workspace-level
 * failure as idle.failed. Message turns (no task lifecycle) fold to
 * idle. Defensive: malformed turns fold to idle.
 */
export function turnPhaseOfTurn(turn: TurnModel | null | undefined): TurnPhase {
  const isTaskTurn = typeof turn?.turnId === "string" && turn.turnId.startsWith("task-")
  let phase = transitionTurnPhase(IDLE_TURN_PHASE, { type: "started", live: isTaskTurn })
  if (!isTaskTurn || turn === null || turn === undefined || !Array.isArray(turn.units)) return phase

  for (const unit of turn.units) {
    if (unit === null || typeof unit !== "object") continue
    switch (unit.kind) {
      case "retry":
        phase = transitionTurnPhase(phase, retryStepOf(unit))
        break
      case "task-status":
        phase = transitionTurnPhase(phase, taskStatusStepOf(unit))
        break
      case "failed":
        phase = transitionTurnPhase(phase, {
          type: "idle.failed",
          error: { text: unit.error },
        })
        break
      default:
        // Tool calls, text narration, permissions — the turn keeps working.
        phase = transitionTurnPhase(phase, {
          type: "step",
          active: true,
          session: "busy",
          completed: false,
        })
        break
    }
  }
  return phase
}
