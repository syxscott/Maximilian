// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT

/**
 * Submission admission grading (pi borrowing: `durable/src/harness/
 * submissions.ts` display-only writes, commit e6b9a6af5).
 *
 * Reserved system namespace for display kinds: `max.` (the host prefix —
 * pi reserves `pi.` for the same reason).
 *
 * Submissions are graded by ONE question: does the write affect what the
 * model sees? A submission that carries only DISPLAY fields (a UI
 * annotation, a title, a transcript garnish) changes nothing the model
 * reads back, so blocking it behind the execution queue buys nothing:
 *
 *   - it is appended and settled `done` AT ONCE, busy or not,
 *   - even ahead of earlier queued items (it cannot reorder semantics —
 *     it is invisible to the model),
 *   - with a single exception: behind a QUEUED RESET (`head: "self"`)
 *     it still queues, so it lands after the reset instead of before it
 *     in the context the reset is about to cut away (a pre-reset landing
 *     would let the reset hide it).
 *
 * Everything else keeps the ordinary admission ladder: input on a busy
 * conversation queues (or rejects), idle input runs, ordinary writes
 * queue behind queued work.
 *
 * Pure functions: the caller owns the ledger. `SubmissionAdmission` in
 * session-store documents the write-admission contract; the queue package
 * consumes the same grading for its bookkeeping side.
 */

/** Application kinds may not squat the system namespace. */
export const SYSTEM_KIND_PREFIX = "max."

/**
 * How a submission touches the conversation:
 * - `input`    — user input; always affects the model context.
 * - `write`    — an entry append; affects context only through its
 *                model/head/edits fields.
 * - `reset`    — cuts the context back to `head`; the strongest effect.
 */
export type SubmissionType = "input" | "write" | "reset"

/** Display payload of a submission (UI-visible, model-invisible). */
export interface DisplayPayload {
  /**
   * The display kind — a non-empty string outside the reserved system
   * prefix {@link SYSTEM_KIND_PREFIX}, mirroring pi's InputEntry
   * discipline.
   */
  kind: string
  data?: unknown
}

/** The submission draft handed to admission. */
export interface SubmissionDraft {
  type: SubmissionType
  /** User input content — present iff type is "input". */
  content?: unknown
  /** Display-only payload (title, annotation). Model-invisible. */
  display?: DisplayPayload
  /** Model-context payload (model-visible entry data). */
  model?: unknown
  /** Context head pointer; the string "self" marks a reset. */
  head?: unknown
  /** Edits to existing context entries. */
  edits?: unknown
  /** For inputs: what to do when the conversation is busy. */
  whenBusy?: "queue" | "reject"
}

/** Items that can sit in the execution queue ahead of a submission. */
export interface QueuedSubmission {
  id: string
  draft: SubmissionDraft
}

/** The observed execution state of one conversation/ledger. */
export interface QueueState {
  /** A run is in flight. */
  busy: boolean
  /** Items already queued, oldest first. */
  queued: readonly QueuedSubmission[]
}

/**
 * Admission decisions:
 * - `bypass-immediate` — append + settle done NOW, ahead of queued items.
 * - `run`              — start a run for this input immediately.
 * - `queue`            — append to the execution queue (position given by
 *                        `behindCount`), preserving FIFO semantics.
 * - `reject-busy`      — refused (`whenBusy: "reject"` input on a busy run).
 */
export type AdmissionDecision = "bypass-immediate" | "run" | "queue" | "reject-busy"

export interface Admission {
  decision: AdmissionDecision
  /** Why — for logs and tests. */
  reason: string
  /** For `queue`: how many queued items this submission lands behind. */
  behindCount?: number
}

/** Items in the queue that would reset the context when they land. */
export function hasQueuedReset(queued: readonly QueuedSubmission[]): boolean {
  return queued.some((item) => item.draft.type === "reset" || item.draft.head === "self")
}

/**
 * Whether `draft` carries ONLY display semantics: a write whose model,
 * head, and edits are all absent — it cannot change what the model sees
 * (pi's isDisplayOnly, extended with the explicit display payload being
 * required so an EMPTY write is not waved through).
 */
export function isDisplayOnlySubmission(draft: SubmissionDraft): boolean {
  if (draft.type !== "write") return false
  if (draft.model !== undefined || draft.head !== undefined || draft.edits !== undefined) {
    return false
  }
  const display = draft.display
  return (
    display !== undefined &&
    typeof display.kind === "string" &&
    display.kind.length > 0 &&
    !display.kind.startsWith(SYSTEM_KIND_PREFIX)
  )
}

/** Whether `draft` touches the model context at all. */
export function affectsModelContext(draft: SubmissionDraft): boolean {
  if (draft.type === "reset") return true
  if (draft.type === "input") return true
  return draft.model !== undefined || draft.head !== undefined || draft.edits !== undefined
}

/**
 * The admission ladder. Order of checks IS the semantics:
 *  1. display-only write with NO queued reset → bypass (even when busy,
 *     even ahead of earlier queued items);
 *  2. display-only write WITH a queued reset → queue behind them (the
 *     reset must not hide it);
 *  3. reject-busy input on a busy run;
 *  4. busy (or non-empty queue) → queue at the back;
 *  5. idle, empty queue → run.
 */
export function admitSubmission(draft: SubmissionDraft, state: QueueState): Admission {
  if (draft.type === "write" && isDisplayOnlySubmission(draft)) {
    if (hasQueuedReset(state.queued)) {
      return {
        decision: "queue",
        reason: "display-only write queued behind a pending reset (reset must not hide it)",
        behindCount: state.queued.length,
      }
    }
    return {
      decision: "bypass-immediate",
      reason: "display-only write affects no model context; appended and settled at once",
    }
  }
  if (draft.type === "input" && state.busy && draft.whenBusy === "reject") {
    return { decision: "reject-busy", reason: "busy conversation and input asked to reject" }
  }
  if (state.busy || state.queued.length > 0) {
    return {
      decision: "queue",
      reason: state.busy ? "run in flight" : "queued items must land first",
      behindCount: state.queued.length,
    }
  }
  return { decision: "run", reason: "idle conversation with an empty queue" }
}
