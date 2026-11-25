// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Goal final reply — the small state machine that turns a goal reaching its
 * terminal state into EXACTLY ONE final-reply event.
 *
 * minimax-code borrowing: `ChannelFinalReplyObserver`
 * (`channel-system/delivery/`) gates delivery on a durable terminal status,
 * and `settlementTransitionDecision` (`thread-goal/settlement-transitions.ts
 * `) makes the settle decision a pure, stage-numbered function so a turn
 * racing settlement can only ever commit one terminal outcome. The
 * reply fingerprint repeats `fingerprintThreadGoalReply` (`goal
 * /reply-fingerprint.ts`): line endings and outer whitespace are presentation
 * variance; the hash covers the semantic text.
 *
 * Lifecycle: `idle → working → final-reply → closed`. The runtime emits the
 * `goal-final-reply` event ONLY on the `working → final-reply` edge, so a
 * repeated resolve, a duplicate done event, or a re-executed workspace can
 * never duplicate the terminal answer.
 */

import { createHash } from "node:crypto"
import { truncateWithoutSplittingSurrogatePair } from "./text-safe.js"

export type GoalFinalReplyState = "idle" | "working" | "final-reply" | "closed"

export type GoalFinalReplyEvent =
  /** A goal is now being pursued (idle/closed → working). */
  | "goal-started"
  /** The goal reached its terminal state — the one edge that emits the reply. */
  | "goal-reached"
  /** The final reply was delivered downstream; the goal can close. */
  | "reply-acked"
  /** The goal was abandoned without a final reply (working/final-reply → idle). */
  | "goal-cancelled"

const TRANSITIONS: Record<GoalFinalReplyState, ReadonlyArray<GoalFinalReplyEvent>> = {
  idle: ["goal-started"],
  working: ["goal-reached", "goal-cancelled"],
  "final-reply": ["reply-acked", "goal-cancelled"],
  closed: ["goal-started"],
}

export function canDriveGoalFinalReply(
  state: GoalFinalReplyState,
  event: GoalFinalReplyEvent,
): boolean {
  return TRANSITIONS[state].includes(event)
}

export interface GoalFinalReplyDrive {
  readonly accepted: boolean
  /** True ONLY on the accepted `working → final-reply` edge. */
  readonly emitFinalReply: boolean
  readonly state: GoalFinalReplyState
  /** Why the event was rejected (accepted events carry no reason). */
  readonly reason?: string
}

const accepted = (state: GoalFinalReplyState, emitFinalReply: boolean): GoalFinalReplyDrive => ({
  accepted: true,
  emitFinalReply,
  state,
})

const rejected = (state: GoalFinalReplyState, reason: string): GoalFinalReplyDrive => ({
  accepted: false,
  emitFinalReply: false,
  state,
  reason,
})

/**
 * Pure transition step. An invalid event leaves the state unchanged and is
 * reported — never thrown — so the machine can sit behind an event stream
 * without becoming a throw path.
 */
export function driveGoalFinalReply(
  state: GoalFinalReplyState,
  event: GoalFinalReplyEvent,
): GoalFinalReplyDrive {
  if (!canDriveGoalFinalReply(state, event)) {
    return rejected(state, `invalid transition: ${state} --${event}--> ?`)
  }
  switch (event) {
    case "goal-started":
      return accepted("working", false)
    case "goal-reached":
      return accepted("final-reply", true)
    case "reply-acked":
      return accepted("closed", false)
    case "goal-cancelled":
      return accepted("idle", false)
  }
}

/**
 * Error-first collection invariant (swarms `agent_answer` borrowing): when a
 * concurrent unit fails, its collected answer IS the error — `Error: <msg>` —
 * even when earlier rounds left partial output in memory, because an error is
 * more honest than a truncated answer. Partial output is presented only when
 * no error exists.
 */
export function errorFirstReply(outcome: { error?: unknown; output?: string | undefined }): string {
  if (outcome.error !== undefined && outcome.error !== null && outcome.error !== "") {
    return `Error: ${outcome.error instanceof Error ? outcome.error.message : String(outcome.error)}`
  }
  return outcome.output ?? ""
}

// ── Truncated-result self-description (MiniApps task-dispatcher borrowing) ──
//
// A batch result that carries only the first N chars reads as a complete
// answer unless the cut says so; an absent output must not look like a bare
// status code either. The delivered reply therefore appends an explicit
// truncation notice whenever text was clipped, and the source Result can be
// tagged via `Result.metadata.resultTruncated` for dashboard consumers.

/** Char budget for one delivered final reply. */
export const GOAL_REPLY_MAX_CHARS = 4_000

/** Stable metadata key marking a result whose stored output was clipped. */
export const RESULT_TRUNCATED_METADATA_KEY = "resultTruncated"

/** Appended to a reply whose body did not fit the delivery budget. */
export const RESULT_TRUNCATED_NOTICE = "[result truncated"

/** Explicit wording when a terminal run left no output at all. */
export const NO_OUTPUT_REPLY = "(no output recorded)"

export interface GoalReplyOutcome {
  error?: unknown
  output?: string | undefined
  /** Source record already flagged its stored output as truncated. */
  resultTruncated?: boolean
  /** Stored length when it differs from `output.length` (shown < stored). */
  storedChars?: number
}

export interface GoalReplyAssembly {
  reply: string
  /** True when any clipping happened (budget cut or a pre-flagged record). */
  truncated: boolean
  /** Code units actually delivered before the notice. */
  shownChars: number
  /** Original stored code units the shown text came from. */
  storedChars: number
}

/**
 * Assemble the delivered final reply from a terminal outcome (borrowing;
 * MiniApps task-dispatcher.mjs:202-210): error-first, then clip the output
 * to `maxChars` with a surrogate-pair-safe cut, append a truncation notice
 * when anything was dropped, and spell out "no output" instead of returning
 * an empty string. Pure; persistence/event emission stays with the caller.
 */
export function assembleGoalReply(
  outcome: GoalReplyOutcome,
  maxChars: number = GOAL_REPLY_MAX_CHARS,
): GoalReplyAssembly {
  if (outcome.error !== undefined && outcome.error !== null && outcome.error !== "") {
    const reply = `Error: ${outcome.error instanceof Error ? outcome.error.message : String(outcome.error)}`
    return { reply, truncated: false, shownChars: reply.length, storedChars: 0 }
  }
  const raw = outcome.output ?? ""
  const stored = Math.max(raw.length, outcome.storedChars ?? raw.length)
  const limit = Math.max(0, Math.floor(maxChars))
  let body = raw
  let truncated = outcome.resultTruncated === true || stored > raw.length
  if (raw.length > limit) {
    // Surrogate-pair safe (opencode text-boundary.ts borrowing): never end
    // the delivered body on half an astral character.
    body = truncateWithoutSplittingSurrogatePair(raw, limit)
    truncated = true
  }
  // Whitespace-only output is no answer either — normalizeReplyFingerprint
  // already treats it as empty, so the delivered reply must not ship blanks.
  if (body.trim().length === 0) {
    return { reply: NO_OUTPUT_REPLY, truncated, shownChars: 0, storedChars: stored }
  }
  const shown = body.length
  const reply = truncated
    ? `${body}\n${RESULT_TRUNCATED_NOTICE} — showing ${shown} of ${stored} chars]`
    : body
  return { reply, truncated, shownChars: shown, storedChars: stored }
}

/**
 * Fingerprint of one final reply (minimax `fingerprintThreadGoalReply`):
 * CRLF/CR normalized to LF, outer whitespace trimmed, empty → undefined,
 * otherwise sha256 of the semantic text.
 */
export function normalizeReplyFingerprint(text: string | undefined): string | undefined {
  if (text === undefined) return undefined
  const normalized = text.replace(/\r\n?|\n/gu, "\n").trim()
  if (!normalized) return undefined
  return createHash("sha256").update(normalized).digest("hex")
}

export class GoalFinalReplyMachine {
  private currentState: GoalFinalReplyState

  constructor(
    private readonly goalId: string | undefined = undefined,
    initialState: GoalFinalReplyState = "idle",
  ) {
    this.currentState = initialState
  }

  get state(): GoalFinalReplyState {
    return this.currentState
  }

  get id(): string | undefined {
    return this.goalId
  }

  dispatch(event: GoalFinalReplyEvent): GoalFinalReplyDrive {
    const drive = driveGoalFinalReply(this.currentState, event)
    if (drive.accepted) this.currentState = drive.state
    return drive
  }
}
