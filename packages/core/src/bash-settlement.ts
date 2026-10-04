// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Bash task settlement — every background bash execution ends with exactly
 * one settlement record: how it ended, whether the exit status was actually
 * known, how long it ran, and a snapshot of the output observed so far.
 *
 * minimax-code borrowing: `LocalBackgroundBashCompletion`
 * (`bash-runner-lifecycle.ts`) — status `succeeded | failed | canceled` with
 * `endedAt`, `durationMs`, `outputBytes` — and `LocalBackgroundTaskService
 .performStop` (`service.ts`): a stop is a settlement; the interrupted
 * execution is marked `canceled` with the stop reason attached, and a second
 * stopmerely observes the already-settled terminal state (one settlement
 * per execution, concurrent callers reuse it).
 *
 * In Maximilian the runtime does not spawn bash processes itself — bash runs
 * as a tool inside the tool loop (`tool-start` / `tool-end` events). The
 * ledger below is the runtime-side record of those executions:
 *   - `tool-start` (bash) opens a pending execution,
 *   - `tool-end` (bash) settles it with the observed outcome,
 *   - an abort of the owning workspace settles every pending execution as
 *     `cancelled` with `exitStatus: "unknown"` — the process was killed
 *     before it could report an exit.
 */

export type BashSettlementStatus = "completed" | "failed" | "cancelled"
export type BashExitStatus = "known" | "unknown"

export interface BashSettlementRecord {
  /** Stable id of the settlement (`bash-<seq>`), unique per ledger. */
  readonly settlementId: string
  readonly workspaceId: string
  readonly taskId: string
  readonly status: BashSettlementStatus
  /**
   * `known` means the execution reported its own end (exit code or tool
   * outcome). `unknown` means it was killed mid-flight — the status is then
   * always `cancelled`, never guessed.
   */
  readonly exitStatus: BashExitStatus
  readonly exitCode?: number
  readonly durationMs: number
  readonly startedAtMs?: number
  readonly endedAtMs: number
  /** Partial output observed before the end, truncated to the ledger budget. */
  readonly outputSnapshot?: string
  readonly outputTruncated: boolean
  /** Why the execution ended (stop reason, or the tool error). */
  readonly reason?: string
}

export interface BashSettleInput {
  /** Stable settlement id — the ledger mints `bash-<seq>`; callers may use any unique string. */
  settlementId: string
  workspaceId: string
  taskId: string
  /** The process was killed before it could report an exit. */
  interrupted?: boolean
  exitCode?: number
  /** Tool-loop outcome when no real exit code exists (0 / 1 proxy). */
  outcome?: "succeeded" | "failed"
  startedAtMs?: number
  endedAtMs: number
  outputSnapshot?: string
  reason?: string
}

export interface BashSettlementOptions {
  /** Max chars kept of any output snapshot. Default 8000. */
  maxSnapshotChars?: number
}

export interface SettledBashExecution {
  readonly text: string
  readonly truncated: boolean
}

function truncateSnapshot(text: string, maxChars: number): SettledBashExecution {
  if (text.length <= maxChars) return { text, truncated: false }
  return { text: text.slice(0, maxChars), truncated: true }
}

/**
 * The settlement rules. Pure and total: any input yields exactly one
 * terminal record, never a guess about an unknown exit.
 */
export function settleBashExecution(
  input: BashSettleInput,
  opts?: BashSettlementOptions,
): BashSettlementRecord {
  const maxSnapshotChars = opts?.maxSnapshotChars ?? 8_000
  const startedAtMs = input.startedAtMs
  const durationMs = startedAtMs === undefined ? 0 : Math.max(0, input.endedAtMs - startedAtMs)
  const snapshot = input.outputSnapshot
  const settledSnapshot =
    snapshot === undefined ? undefined : truncateSnapshot(snapshot, maxSnapshotChars)

  let status: BashSettlementStatus
  let exitStatus: BashExitStatus
  let exitCode: number | undefined
  if (input.interrupted === true) {
    status = "cancelled"
    exitStatus = "unknown"
  } else if (input.exitCode !== undefined) {
    exitStatus = "known"
    exitCode = input.exitCode
    status = input.exitCode === 0 ? "completed" : "failed"
  } else if (input.outcome !== undefined) {
    exitStatus = "known"
    exitCode = input.outcome === "succeeded" ? 0 : 1
    status = input.outcome === "succeeded" ? "completed" : "failed"
  } else {
    // Exit status unknown without an explicit interruption is still a
    // cancellation: the execution vanished without reporting.
    status = "cancelled"
    exitStatus = "unknown"
  }

  return {
    settlementId: input.settlementId,
    workspaceId: input.workspaceId,
    taskId: input.taskId,
    status,
    exitStatus,
    ...(exitCode !== undefined ? { exitCode } : {}),
    durationMs,
    ...(startedAtMs !== undefined ? { startedAtMs } : {}),
    endedAtMs: input.endedAtMs,
    ...(settledSnapshot !== undefined
      ? { outputSnapshot: settledSnapshot.text, outputTruncated: settledSnapshot.truncated }
      : { outputTruncated: false }),
    ...(input.reason !== undefined ? { reason: input.reason } : {}),
  }
}

/**
 * Best-effort extraction of an output snapshot from an arbitrary tool
 * result. Known shapes are read directly; anything else falls back to
 * JSON so a snapshot is never silently lost.
 */
export function extractOutputSnapshot(result: unknown, maxChars: number): SettledBashExecution {
  if (typeof result === "string") return truncateSnapshot(result, maxChars)
  if (result !== null && typeof result === "object") {
    for (const key of ["output", "content", "text"]) {
      const value = (result as Record<string, unknown>)[key]
      if (typeof value === "string") return truncateSnapshot(value, maxChars)
    }
  }
  const fallback = JSON.stringify(result)
  return fallback === undefined
    ? { text: "", truncated: false }
    : truncateSnapshot(fallback, maxChars)
}

interface PendingBashExecution {
  readonly seq: number
  readonly startedAtMs: number
}

interface ObservedOutput {
  readonly text: string
  readonly truncated: boolean
}

/**
 * Runtime-side ledger of bash executions. One settlement per execution —
 * a second settle of the same execution cannot happen because settling
 * removes the pending entry, and already-settled records are immutable.
 */
export class BashSettlementLedger {
  private readonly pending = new Map<string, PendingBashExecution[]>()
  private readonly observed = new Map<string, ObservedOutput>()
  private readonly recordsByWorkspace = new Map<string, BashSettlementRecord[]>()
  private seq = 0
  private readonly maxSnapshotChars: number

  constructor(opts?: BashSettlementOptions) {
    this.maxSnapshotChars = opts?.maxSnapshotChars ?? 8_000
  }

  private key(workspaceId: string, taskId: string): string {
    return `${workspaceId}\u0000${taskId}`
  }

  /** A bash execution started (tool-start). */
  observeStart(workspaceId: string, taskId: string, startedAtMs = Date.now()): void {
    const key = this.key(workspaceId, taskId)
    const list = this.pending.get(key) ?? []
    list.push({ seq: ++this.seq, startedAtMs })
    this.pending.set(key, list)
  }

  /**
   * Remember the most recent output observed for this task (fed from the
   * tool loop's afterToolCall hook). A settle attaches — and then clears —
   * the latest observation as the partial-output snapshot.
   */
  noteOutput(workspaceId: string, taskId: string, result: unknown): void {
    const snapshot = extractOutputSnapshot(result, this.maxSnapshotChars)
    if (!snapshot.text) return
    this.observed.set(this.key(workspaceId, taskId), snapshot)
  }

  /**
   * A bash execution reported its own end (tool-end). Settles the
   * oldest-started pending execution of the task (sequential tool calls —
   * the default — have exactly one pending, so pairing is exact). Returns
   * undefined only when the tool loop emitted a duplicate end for a task
   * with no bash activity at all.
   */
  observeEnd(
    workspaceId: string,
    taskId: string,
    info: { ok: boolean; durationMs: number; error?: string; endedAtMs?: number },
  ): BashSettlementRecord | undefined {
    const key = this.key(workspaceId, taskId)
    const pendingList = this.pending.get(key)
    const pendingExecution = pendingList?.shift()
    if (pendingList && pendingList.length === 0) this.pending.delete(key)
    const observed = this.observed.get(key)
    // No attributable activity — a duplicate tool-end (the execution was
    // already settled) or an event for a task this ledger never saw start.
    if (!pendingExecution && !observed) return undefined
    this.observed.delete(key)
    const record = settleBashExecution(
      {
        settlementId: `bash-${pendingExecution?.seq ?? ++this.seq}`,
        workspaceId,
        taskId,
        outcome: info.ok ? "succeeded" : "failed",
        // Without a matched start (event seen late) reconstruct the start
        // from the tool loop's own duration so the record keeps the real
        // run time instead of collapsing to 0.
        startedAtMs:
          pendingExecution?.startedAtMs ??
          (info.endedAtMs ?? Date.now()) - Math.max(0, info.durationMs),
        endedAtMs: info.endedAtMs ?? Date.now(),
        ...(observed ? { outputSnapshot: observed.text } : {}),
        reason: info.error,
      },
      { maxSnapshotChars: this.maxSnapshotChars },
    )
    this.file(record)
    return record
  }

  /**
   * The owning workspace was stopped: settle every pending execution as
   * `cancelled` / exit unknown, snapshotting the latest observed output.
   * Returns the new settlements in start order.
   */
  settleInterrupted(
    workspaceId: string,
    reason: string,
    endedAtMs = Date.now(),
  ): BashSettlementRecord[] {
    const settled: BashSettlementRecord[] = []
    const prefix = `${workspaceId}\u0000`
    for (const [key, pendingList] of this.pending) {
      if (!key.startsWith(prefix)) continue
      this.pending.delete(key)
      const observed = this.observed.get(key)
      this.observed.delete(key)
      const taskId = key.slice(prefix.length)
      for (const execution of pendingList) {
        settled.push(
          settleBashExecution(
            {
              settlementId: `bash-${execution.seq}`,
              workspaceId,
              taskId,
              interrupted: true,
              startedAtMs: execution.startedAtMs,
              endedAtMs,
              ...(observed ? { outputSnapshot: observed.text } : {}),
              reason,
            },
            { maxSnapshotChars: this.maxSnapshotChars },
          ),
        )
      }
    }
    // A task whose output was observed but whose start event raced the stop
    // still leaves a cancelled record — the output proves there was activity.
    for (const [key, observed] of this.observed) {
      if (!key.startsWith(prefix)) continue
      this.observed.delete(key)
      const taskId = key.slice(prefix.length)
      settled.push(
        settleBashExecution(
          {
            settlementId: `bash-${++this.seq}`,
            workspaceId,
            taskId,
            interrupted: true,
            endedAtMs,
            outputSnapshot: observed.text,
            reason,
          },
          { maxSnapshotChars: this.maxSnapshotChars },
        ),
      )
    }
    for (const record of settled) this.file(record)
    return settled
  }

  /** All settlements of a workspace, in settle order. */
  records(workspaceId: string): BashSettlementRecord[] {
    return [...(this.recordsByWorkspace.get(workspaceId) ?? [])]
  }

  /** Latest settlement of one task, if any. */
  latest(workspaceId: string, taskId: string): BashSettlementRecord | undefined {
    const records = this.recordsByWorkspace.get(workspaceId)
    if (!records) return undefined
    for (let i = records.length - 1; i >= 0; i--) {
      if (records[i].taskId === taskId) return records[i]
    }
    return undefined
  }

  /** Pending (in-flight) bash executions, total or per workspace. */
  pendingCount(workspaceId?: string): number {
    if (workspaceId === undefined) {
      let total = 0
      for (const list of this.pending.values()) total += list.length
      return total
    }
    const prefix = `${workspaceId}\u0000`
    let total = 0
    for (const [key, list] of this.pending) if (key.startsWith(prefix)) total += list.length
    return total
  }

  private file(record: BashSettlementRecord): void {
    const records = this.recordsByWorkspace.get(record.workspaceId)
    if (records) records.push(record)
    else this.recordsByWorkspace.set(record.workspaceId, [record])
  }
}
