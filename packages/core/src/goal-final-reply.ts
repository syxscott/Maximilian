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
