// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Workflow engine — deterministic, journal-based multi-step execution
 * (minimal port of ZCode's dynamic-workflow engine ideas).
 *
 * A workflow is a sequence of STEPS. Each completed step is recorded in a
 * JOURNAL keyed by `siteId` + `attempt`. On resume:
 *   - the script hash must match byte-for-byte (a different workflow is a
 *     different workflow — refuse rather than mis-replay), and
 *   - journaled step results are short-circuited, so previously completed
 *     steps are not re-executed.
 *
 * Deterministic discipline (ZCode engine borrowing): the engine does no IO
 * itself — steps execute through an injected executor, and the journal is
 * an injected port. Phase markers group steps for progress reporting.
 */

export interface WorkflowStep {
  /** Stable identity of this step within the workflow. */
  siteId: string
  /** Phase marker (progress grouping only — no scheduling semantics). */
  phase?: string
  /** Human description. */
  description?: string
}

export interface WorkflowDefinition {
  /** Byte-for-byte identity of the workflow script/source. Resume refuses mismatches. */
  scriptHash: string
  steps: WorkflowStep[]
}

export interface JournalEntry {
  siteId: string
  /** 0-based re-execution ordinal of this site (retry increments). */
  attempt: number
  /** Step output as persisted by the executor. */
  output: unknown
  ok: boolean
  phase?: string
  recordedAt: string
}

/**
 * Journal persistence port. Backends: SQLite (session-store events table),
 * in-memory (tests), or any future durable log. Must be append-friendly;
 * replay reads all entries for a workflow run.
 */
export interface WorkflowJournalPort {
  append(runId: string, entry: JournalEntry): Promise<void>
  readAll(runId: string): Promise<JournalEntry[]>
}

export interface WorkflowExecutor {
  executeStep(step: WorkflowStep, input: unknown): Promise<unknown>
}

export interface WorkflowRunOptions {
  /** Steps whose input is the previous step's output; default true. */
  chain?: boolean
}

export interface WorkflowRunReport {
  runId: string
  scriptHash: string
  completed: Array<{ siteId: string; output: unknown }>
  skippedFromJournal: number
  phaseProgress: Array<{ phase: string; completedSteps: number }>
}

export class WorkflowScriptChangedError extends Error {
  readonly code = "workflow/script-changed"
  constructor(expected: string, actual: string) {
    super(
      `workflow script changed since the run started (journal: ${expected}, now: ${actual}). ` +
        `Resume requires a byte-identical script — start a new run instead.`,
    )
    this.name = "WorkflowScriptChangedError"
  }
}

export class WorkflowEngine {
  constructor(
    private readonly journal: WorkflowJournalPort,
    private readonly executor: WorkflowExecutor,
  ) {}

  /**
   * Execute (or resume) a workflow run. Journaled step results short-circuit
   * execution; new steps run in order with the previous output as input.
   */
  async run(
    runId: string,
    definition: WorkflowDefinition,
    initialInput: unknown,
    opts: WorkflowRunOptions = {},
  ): Promise<WorkflowRunReport> {
    const previous = await this.journal.readAll(runId)
    if (previous.length > 0) {
      const journaledHash = await this.readScriptHash(runId)
      if (journaledHash !== undefined && journaledHash !== definition.scriptHash) {
        throw new WorkflowScriptChangedError(journaledHash, definition.scriptHash)
      }
    }
    await this.writeScriptHash(runId, definition.scriptHash)

    const done = new Map<string, unknown>()
    let skippedFromJournal = 0

    for (const step of definition.steps) {
      const journaled = previous.find((e) => e.siteId === step.siteId && e.ok)
      if (journaled) {
        done.set(step.siteId, journaled.output)
        skippedFromJournal += 1
        continue
      }
      const input =
        opts.chain !== false && done.size > 0
          ? (done.get(previousInputOf(definition.steps, step.siteId) ?? "") ?? initialInput)
          : initialInput
      let output: unknown
      let ok = true
      try {
        output = await this.executor.executeStep(step, input)
      } catch (err) {
        ok = false
        output = { error: String(err) }
      }
      await this.journal.append(runId, {
        siteId: step.siteId,
        attempt: 0,
        output,
        ok,
        phase: step.phase,
        recordedAt: new Date().toISOString(),
      })
      if (!ok) throw new Error(`workflow step ${step.siteId} failed: ${JSON.stringify(output)}`)
      done.set(step.siteId, output)
    }

    const phaseProgress = buildPhaseProgress(definition.steps, done)
    const completed = definition.steps
      .filter((s) => done.has(s.siteId))
      .map((s) => ({ siteId: s.siteId, output: done.get(s.siteId) }))

    return {
      runId,
      scriptHash: definition.scriptHash,
      completed,
      skippedFromJournal,
      phaseProgress,
    }
  }

  /** Script hash bookkeeping lives in the journal as a meta row (siteId = "__script_hash__"). */
  private async readScriptHash(runId: string): Promise<string | undefined> {
    const entries = await this.journal.readAll(runId)
    const meta = entries.find((e) => e.siteId === SCRIPT_HASH_SITE)
    return (meta?.output as string | undefined) ?? undefined
  }

  private async writeScriptHash(runId: string, hash: string): Promise<void> {
    const entries = await this.journal.readAll(runId)
    if (entries.some((e) => e.siteId === SCRIPT_HASH_SITE)) return
    await this.journal.append(runId, {
      siteId: SCRIPT_HASH_SITE,
      attempt: 0,
      output: hash,
      ok: true,
      recordedAt: new Date().toISOString(),
    })
  }
}

const SCRIPT_HASH_SITE = "__script_hash__"

function previousInputOf(steps: WorkflowStep[], siteId: string): string | undefined {
  const idx = steps.findIndex((s) => s.siteId === siteId)
  return idx > 0 ? steps[idx - 1]!.siteId : undefined
}

function buildPhaseProgress(
  steps: WorkflowStep[],
  done: Map<string, unknown>,
): Array<{ phase: string; completedSteps: number }> {
  const byPhase = new Map<string, number>()
  for (const step of steps) {
    const phase = step.phase ?? "default"
    if (done.has(step.siteId)) byPhase.set(phase, (byPhase.get(phase) ?? 0) + 1)
  }
  return [...byPhase.entries()].map(([phase, completedSteps]) => ({ phase, completedSteps }))
}
