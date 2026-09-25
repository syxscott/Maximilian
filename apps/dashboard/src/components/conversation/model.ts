// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Conversation turn-unit pipeline (deepseek ui-conversation borrowing:
 * ConversationTurnRenderUnits / conversationTurnFlowItems / turn-group
 * navigation at the model layer). The model layer BEHIND
 * ConversationTimeline: the event stream compiles into a flat stream of
 * RENDER UNITS — paired tool calls (with a running state), folded retry
 * waves, request/resolved permission pairs and text segments — each
 * tagged with the turn (conversation group) it belongs to. Presentation
 * (TurnGroup / RetryWaveGroup / ConversationUnitsPreview) renders the
 * units verbatim; all pairing and folding decisions live here so the UI
 * can never disagree with itself.
 *
 * Pure functions over passthrough payloads: every event field may be
 * missing or the wrong type (the RuntimeEvent schema is
 * `.passthrough()`), so access is coerced defensively everywhere.
 */

import type { RuntimeEvent, Workspace } from "@/api"

// ── Defensive coercions (passthrough payloads) ──────────────────────────────

const asStr = (v: unknown, max = 200): string | undefined =>
  typeof v === "string" && v.length > 0 ? v.slice(0, max) : undefined
const asNum = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined
const asBool = (v: unknown): boolean | undefined => (typeof v === "boolean" ? v : undefined)

/** Narrow one passthrough array entry to an event record, or drop it. */
function asEvent(raw: unknown): RuntimeEvent | null {
  if (raw === null || typeof raw !== "object") return null
  const rec = raw as Record<string, unknown>
  return typeof rec.type === "string" ? (raw as RuntimeEvent) : null
}

/** Coerce a passthrough timestamp (epoch number or ISO string) to epoch ms. */
export function eventTs(e: RuntimeEvent): number | undefined {
  const raw = (e as Record<string, unknown>).ts
  if (typeof raw === "number" && Number.isFinite(raw)) return raw
  if (typeof raw === "string" && raw !== "") {
    const parsed = Date.parse(raw)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

const eventField = (e: RuntimeEvent, field: string, max = 200): string | undefined =>
  asStr((e as Record<string, unknown>)[field], max)

/**
 * Bounded JSON text for search/export — passthrough inputs are already
 * JSON-shaped, but the guard keeps malformed objects from throwing.
 */
function boundedJson(value: unknown, max = 4000): string {
  try {
    const text = JSON.stringify(value ?? "")
    return text === undefined ? "" : text.slice(0, max)
  } catch {
    return String(value ?? "").slice(0, max)
  }
}

// ── pairToolCalls ───────────────────────────────────────────────────────────

/** State of one tool invocation in the unit stream. */
export type ToolUnitState = "running" | "ok" | "error"

export interface ToolPair {
  /** Stable unit key derived from the tool-start position. */
  key: string
  taskId: string
  tool: string
  input: unknown
  state: ToolUnitState
  /** End-event fields — undefined while running or when the end is malformed. */
  ok?: boolean
  durationMs?: number
  error?: string
  /** Defensive exit-code passthrough (tool-end.exitCode when emitted). */
  exitCode?: number
  /** Input-stream position of the tool-start event. */
  startIndex: number
  /** Input-stream position of the pairing tool-end, undefined while running. */
  endIndex?: number
}

/**
 * Pair tool-start/tool-end events FIFO per (taskId, toolName) — the fix
 * for the timeline's last-match guess, which could attach an end to the
 * wrong concurrent invocation of the same tool. The OLDEST open start
 * with the same key takes the end; starts without an end stay
 * `running`; ends without a start are ignored (never invent a pair).
 */
export function pairToolCalls(events: RuntimeEvent[]): ToolPair[] {
  const pairs: ToolPair[] = []
  const open = new Map<string, ToolPair[]>()
  const queueKey = (taskId: string, tool: string): string => `${taskId}\u0000${tool}`

  events.forEach((raw, index) => {
    const e = asEvent(raw)
    if (!e) return
    if (e.type === "tool-start") {
      const taskId = eventField(e, "taskId") ?? ""
      const tool = eventField(e, "toolName", 120) ?? "?"
      const pair: ToolPair = {
        key: `tool-${index}`,
        taskId,
        tool,
        input: (e as Record<string, unknown>).input,
        state: "running",
        startIndex: index,
      }
      pairs.push(pair)
      const key = queueKey(taskId, tool)
      const queue = open.get(key)
      if (queue) queue.push(pair)
      else open.set(key, [pair])
      return
    }
    if (e.type === "tool-end") {
      const taskId = eventField(e, "taskId") ?? ""
      const tool = eventField(e, "toolName", 120) ?? "?"
      const pair = open.get(queueKey(taskId, tool))?.shift()
      if (!pair) return // unpaired end — ignore, never fabricate a start
      const rec = e as Record<string, unknown>
      pair.ok = asBool(rec.ok)
      pair.durationMs = asNum(rec.durationMs)
      pair.error = asStr(rec.error, 500)
      pair.exitCode = asNum(rec.exitCode)
      pair.state = pair.ok === false ? "error" : "ok"
      pair.endIndex = index
    }
  })
  return pairs
}

// ── groupRetryWaves ─────────────────────────────────────────────────────────

export interface RetryWave {
  /** Passthrough phase label — "waiting" | "recovered" | "exhausted" today. */
  phase: string
  /** How many llm-retry-status events folded into the wave. */
  attempts: number
  /** Sum of the wave's delayMs values (malformed counts contribute 0). */
  totalDelayMs: number
  /** Epoch ms of the first/last event in the wave (undefined when no ts). */
  firstAt?: number
  lastAt?: number
}

interface RetryWaveAcc extends RetryWave {
  providerId?: string
  /** Last event's detail — the folded "waitings collapse to the last one". */
  attempt?: number
  maxAttempts?: number
  reason?: string
  /** Per-attempt trail for the expanded wave view (≤20 kept, oldest first). */
  entries: Array<{ phase: string; attempt?: number; delayMs?: number; reason?: string }>
  firstIndex: number
}

const RETRY_ENTRY_CAP = 20

/** Group CONSECUTIVE same-phase llm-retry-status events into waves. */
function accumulateRetryWaves(events: RuntimeEvent[]): RetryWaveAcc[] {
  const waves: RetryWaveAcc[] = []
  let current: RetryWaveAcc | null = null

  events.forEach((raw, index) => {
    const e = asEvent(raw)
    if (!e || e.type !== "llm-retry-status") return
    const rec = e as Record<string, unknown>
    const phase = asStr(rec.phase, 40) ?? "waiting"
    const delayMs = asNum(rec.delayMs) ?? 0
    const at = eventTs(e)

    if (!current || current.phase !== phase) {
      current = {
        phase,
        attempts: 0,
        totalDelayMs: 0,
        firstAt: at,
        firstIndex: index,
        entries: [],
      }
      waves.push(current)
    }
    current.attempts += 1
    current.totalDelayMs += delayMs
    if (at !== undefined) current.lastAt = at
    const providerId = asStr(rec.providerId, 120)
    if (providerId !== undefined) current.providerId = providerId
    current.attempt = asNum(rec.attempt)
    current.maxAttempts = asNum(rec.maxAttempts)
    current.reason = asStr(rec.reason, 300)
    if (current.entries.length < RETRY_ENTRY_CAP) {
      current.entries.push({
        phase,
        attempt: asNum(rec.attempt),
        delayMs: asNum(rec.delayMs),
        reason: asStr(rec.reason, 300),
      })
    }
  })
  return waves
}

/** Standalone wave view over the raw stream (spec-exact fields). */
export function groupRetryWaves(events: RuntimeEvent[]): RetryWave[] {
  return accumulateRetryWaves(events).map((wave) => ({
    phase: wave.phase,
    attempts: wave.attempts,
    totalDelayMs: wave.totalDelayMs,
    firstAt: wave.firstAt,
    lastAt: wave.lastAt,
  }))
}

// ── Conversation units (the compiled render stream) ─────────────────────────

export type ConversationUnitKind =
  "text" | "task" | "tool" | "retry" | "permission" | "task-status" | "review" | "failed"

interface UnitBase {
  /** Stable key for React / find navigation. */
  key: string
  /** Turn (conversation group) the unit belongs to. */
  turnId: string
  /** Author role at compile time — "user", the agentRole, or "assistant". */
  role: string
  /** Task id when the unit is task-scoped. */
  taskId?: string
  /** Position of the source event(s) in the input stream. */
  index: number
  /** Epoch ms of the source event, when it carries a ts. */
  at?: number
}

export interface TextUnit extends UnitBase {
  kind: "text"
  text: string
  /**
   * Provenance for text segments extracted from textUnits (steering
   * injections, system-side task prose) — TextUnitBlock styles per
   * source. undefined = ordinary stream narration.
   */
  source?: TextUnitSource
}

/**
 * Turn-opening marker for a task-start. Carries no visible body — the
 * TurnGroup header renders it — but keeps the stream lossless: a task
 * that has not emitted anything yet still owns a turn (running, empty).
 */
export interface TaskUnit extends UnitBase {
  kind: "task"
  taskId: string
}

export interface ToolUnit extends UnitBase {
  kind: "tool"
  taskId: string
  tool: string
  input: unknown
  state: ToolUnitState
  ok?: boolean
  durationMs?: number
  error?: string
  exitCode?: number
}

export interface RetryUnit extends UnitBase {
  kind: "retry"
  phase: string
  attempts: number
  totalDelayMs: number
  /** Wave-window timestamps (the base `at` mirrors firstAt). */
  firstAt?: number
  lastAt?: number
  providerId?: string
  /** Last folded attempt detail (collapsed display). */
  attempt?: number
  maxAttempts?: number
  reason?: string
  /** Per-attempt trail (expanded display, oldest first, ≤20). */
  entries: Array<{ phase: string; attempt?: number; delayMs?: number; reason?: string }>
}

export type PermissionState = "pending" | "allowed" | "denied"

export interface PermissionUnit extends UnitBase {
  kind: "permission"
  taskId: string
  requestId: string
  tool: string
  target?: string
  input: unknown
  state: PermissionState
  /** Raw passthrough decision ("allow" | "deny" | "allow-always" | …). */
  decision?: string
  /** How it was decided: "user" | "always-rule" | "timeout" | "auto-review". */
  via?: string
  reason?: string
}

export interface TaskStatusUnit extends UnitBase {
  kind: "task-status"
  taskId: string
  status: "completed" | "failed" | "skipped"
  error?: string
}

export interface ReviewUnit extends UnitBase {
  kind: "review"
  score?: number
  summary?: string
}

export interface FailedUnit extends UnitBase {
  kind: "failed"
  error: string
}

export type ConversationUnit =
  | TextUnit
  | TaskUnit
  | ToolUnit
  | RetryUnit
  | PermissionUnit
  | TaskStatusUnit
  | ReviewUnit
  | FailedUnit

// ── buildTurnFlowItems ──────────────────────────────────────────────────────

/** First text-bearing field on a passthrough event (store precedent). */
function eventText(e: RuntimeEvent): string | undefined {
  const rec = e as Record<string, unknown>
  return asStr(rec.text, 8000) ?? asStr(rec.message, 8000)
}

const SYSTEM_TURN_ID = "system"

/**
 * Event field carrying a TextUnitSource provenance — set by the
 * synthetic text events withTextUnitEvents splices into the render
 * stream (plain stream events never carry it, so ordinary narration
 * stays unstyled).
 */
export const TEXT_SOURCE_FIELD = "textSource"

/** Narrow a passthrough value to a known TextUnitSource, or drop it. */
function asTextSource(v: unknown): TextUnitSource | undefined {
  return v === "user" || v === "system" || v === "steering" ? v : undefined
}

/**
 * Compile the event stream + workspace into the render-unit stream —
 * one flat array, each unit tagged with its turn:
 *
 *   - task-start emits a `task` marker unit (turn-opening anchor — the
 *     TurnGroup header renders it) so a task that has not produced any
 *     other unit yet still owns a live turn;
 *   - tool-start/tool-end fold into ONE tool unit per call (running
 *     until its FIFO pair lands — see pairToolCalls);
 *   - consecutive same-phase llm-retry-status events fold into ONE
 *     retry unit per wave, collapsed to the last attempt's detail but
 *     keeping the per-attempt trail for the expanded view;
 *   - permission-request waits as `pending` and its matching
 *     permission-resolved (by requestId) mutates it to allowed/denied;
 *     a resolved without a request still emits (stream join mid-run);
 *   - text-bearing events join their task's turn, or form their own
 *     message turn when they carry no taskId (store precedent);
 *   - task-complete/failed/skipped become task-status units;
 *   - workspace.userRequest leads as the user text unit; review and
 *     workspace failure trail as their own units. Heartbeat noise
 *     (ledger / workspace-status / plan / done / steering / approval)
 *     is excluded, like deriveTrajectory.
 */
export function buildTurnFlowItems(
  events: RuntimeEvent[],
  workspace: Workspace | null,
): ConversationUnit[] {
  const units: ConversationUnit[] = []
  const pairsByStart = new Map(
    pairToolCalls(events).map((pair) => [pair.startIndex, pair] as const),
  )
  const pendingPermissions = new Map<string, PermissionUnit>()
  /** Task turns opened but not yet closed, most recent last. */
  const openTaskTurns: string[] = []
  /** Turn each retry event landed in (assigned in stream order). */
  const retryTurnByIndex = new Map<number, string>()
  /** Turn id → author role (established by task-start / first event). */
  const turnRoles = new Map<string, string>()

  const turnFor = (taskId: string): string => `task-${taskId}`
  /** Role of a unit: explicit event override, else the turn's role. */
  const roleFor = (turnId: string, override: string | undefined): string => {
    const role = override ?? turnRoles.get(turnId) ?? "assistant"
    if (!turnRoles.has(turnId)) turnRoles.set(turnId, role)
    return role
  }

  // Leading user request — the conversation's first turn.
  const userRequest = workspace === null ? undefined : asStr(workspace.userRequest, 8000)
  if (userRequest !== undefined) {
    units.push({
      kind: "text",
      key: "text-user",
      turnId: "user",
      role: "user",
      text: userRequest,
      index: -1,
    })
  }

  events.forEach((raw, index) => {
    const e = asEvent(raw)
    if (!e) return
    const rec = e as Record<string, unknown>
    const taskId = asStr(rec.taskId) ?? ""
    const at = eventTs(e)

    switch (e.type) {
      case "task-start": {
        const id = taskId || `anon-${index}`
        const turnId = turnFor(id)
        // A start for an already-open turn is a duplicate — the marker
        // is emitted once; a REstart after task-status re-opens, with a
        // fresh marker, which is the signal the marker exists for.
        if (!openTaskTurns.includes(turnId)) {
          openTaskTurns.push(turnId)
          units.push({
            kind: "task",
            key: `task-${index}`,
            turnId,
            role: roleFor(turnId, eventField(e, "agentRole", 40)),
            taskId: id,
            index,
            at,
          })
        }
        return
      }
      case "tool-start": {
        const pair = pairsByStart.get(index)
        if (!pair) return
        const id = taskId || `anon-${index}`
        const turnId = turnFor(id)
        if (!openTaskTurns.includes(turnId)) openTaskTurns.push(turnId)
        units.push({
          kind: "tool",
          key: pair.key,
          turnId,
          role: roleFor(turnId, eventField(e, "agentRole", 40)),
          taskId: id,
          index,
          at,
          tool: pair.tool,
          input: pair.input,
          state: pair.state,
          ok: pair.ok,
          durationMs: pair.durationMs,
          error: pair.error,
          exitCode: pair.exitCode,
        })
        return
      }
      case "llm-retry-status":
        // Folded below, wave-by-wave — but the open turn is snapshotted
        // NOW, in stream order.
        retryTurnByIndex.set(index, openTaskTurns.at(-1) ?? SYSTEM_TURN_ID)
        return
      case "permission-request": {
        const id = taskId || `anon-${index}`
        const requestId = eventField(e, "requestId", 200) ?? `req-${index}`
        const turnId = turnFor(id)
        units.push({
          kind: "permission",
          key: `permission-${index}`,
          turnId,
          role: roleFor(turnId, eventField(e, "agentRole", 40)),
          taskId: id,
          index,
          at,
          requestId,
          tool: eventField(e, "tool", 120) ?? "?",
          target: eventField(e, "target", 300),
          input: rec.input,
          state: "pending",
        })
        pendingPermissions.set(requestId, units.at(-1) as PermissionUnit)
        return
      }
      case "permission-resolved": {
        const requestId = eventField(e, "requestId", 200) ?? `req-${index}`
        const pending = pendingPermissions.get(requestId)
        const decision = eventField(e, "decision", 40)
        const state: PermissionState = decision === "deny" ? "denied" : "allowed"
        if (pending) {
          pending.state = state
          pending.decision = decision
          pending.via = eventField(e, "via", 40)
          pending.reason = eventField(e, "reason", 300)
          pendingPermissions.delete(requestId)
          return
        }
        // Resolved without its request (stream join mid-run) — emit standalone.
        const id = taskId || `anon-${index}`
        const orphanTurn = turnFor(id)
        units.push({
          kind: "permission",
          key: `permission-${index}`,
          turnId: orphanTurn,
          role: roleFor(orphanTurn, eventField(e, "agentRole", 40)),
          taskId: id,
          index,
          at,
          requestId,
          tool: eventField(e, "tool", 120) ?? "?",
          input: undefined,
          state,
          decision,
          via: eventField(e, "via", 40),
          reason: eventField(e, "reason", 300),
        })
        return
      }
      case "task-complete":
      case "task-failed":
      case "task-skipped": {
        const id = taskId || `anon-${index}`
        const turnId = turnFor(id)
        const status: TaskStatusUnit["status"] =
          e.type === "task-complete" ? "completed" : e.type === "task-failed" ? "failed" : "skipped"
        units.push({
          kind: "task-status",
          key: `task-status-${index}`,
          turnId,
          role: roleFor(turnId, eventField(e, "agentRole", 40)),
          taskId: id,
          index,
          at,
          status,
          error:
            e.type === "task-failed"
              ? eventField(e, "error", 500)
              : e.type === "task-skipped"
                ? eventField(e, "reason", 500)
                : undefined,
        })
        const openIndex = openTaskTurns.indexOf(turnId)
        if (openIndex >= 0) openTaskTurns.splice(openIndex, 1)
        return
      }
      default: {
        // Text-bearing events (store precedent: `text` / `message` fields)
        // join their task's turn, or form a standalone message turn.
        const text = eventText(e)
        if (text === undefined) return
        const source = asTextSource(rec[TEXT_SOURCE_FIELD])
        if (taskId) {
          const turnId = turnFor(taskId)
          if (!openTaskTurns.includes(turnId)) openTaskTurns.push(turnId)
          units.push({
            kind: "text",
            key: `text-${index}`,
            turnId,
            role: roleFor(turnId, eventField(e, "role", 40) ?? eventField(e, "agentRole", 40)),
            taskId,
            index,
            at,
            text,
            ...(source !== undefined ? { source } : {}),
          })
        } else {
          units.push({
            kind: "text",
            key: `text-${index}`,
            turnId: `msg-${index}`,
            role: eventField(e, "role", 40) ?? eventField(e, "agentRole", 40) ?? "assistant",
            index,
            at,
            text,
            ...(source !== undefined ? { source } : {}),
          })
        }
      }
    }
  })

  // Retry waves fold over the raw stream and attach to the turn that was
  // open when the wave started ("system" when none was). They splice back
  // into stream position via the sort below.
  for (const wave of accumulateRetryWaves(events)) {
    const turnId = retryTurnByIndex.get(wave.firstIndex) ?? SYSTEM_TURN_ID
    units.push({
      kind: "retry",
      key: `retry-${wave.firstIndex}`,
      turnId,
      role: turnRoles.get(turnId) ?? "assistant",
      index: wave.firstIndex,
      at: wave.firstAt,
      phase: wave.phase,
      attempts: wave.attempts,
      totalDelayMs: wave.totalDelayMs,
      firstAt: wave.firstAt,
      lastAt: wave.lastAt,
      providerId: wave.providerId,
      attempt: wave.attempt,
      maxAttempts: wave.maxAttempts,
      reason: wave.reason,
      entries: wave.entries,
    })
  }
  // Restore stream order: retry units were folded in a second pass, the
  // user request carries index -1 and workspace units events.length.
  units.sort((a, b) => a.index - b.index)

  // Workspace-level verdicts trail the stream.
  if (workspace?.status === "failed" && asStr(workspace.error, 2000)) {
    units.push({
      kind: "failed",
      key: "failed-workspace",
      turnId: "workspace",
      role: "system",
      index: events.length,
      error: String(workspace.error),
    })
  }
  const review = workspace?.review
  if (review && asNum(review.score) !== undefined) {
    units.push({
      kind: "review",
      key: "review-workspace",
      turnId: "review",
      role: "review",
      index: events.length,
      score: review.score,
      summary: asStr(review.summary, 2000),
    })
  }

  return units
}

// ── estimateTurnDepth ───────────────────────────────────────────────────────

/**
 * Nesting depth per turnId, for indented rendering. Task turns
 * (`task-…` ids, as synthesized by buildTurnFlowItems) nest under the
 * turns that were still open when they first emitted: depth 1 = top
 * level, 2 = subagent spawned by an open parent, and so on. A
 * task-status unit closes its turn, so work started after a sibling
 * finished is back at depth 1. Non-task turns (user request, message
 * segments, review, system) are always conversation roots at depth 1.
 */
export function estimateTurnDepth(units: ConversationUnit[]): Map<string, number> {
  const depth = new Map<string, number>()
  const open = new Set<string>()
  for (const unit of units) {
    if (unit.turnId.startsWith("task-")) {
      if (!depth.has(unit.turnId)) {
        depth.set(unit.turnId, open.size + 1)
        open.add(unit.turnId)
      }
      if (unit.kind === "task-status") open.delete(unit.turnId)
    } else if (!depth.has(unit.turnId)) {
      depth.set(unit.turnId, 1)
    }
  }
  return depth
}

// ── groupUnitsByTurn (turn-group view model for TurnGroup) ──────────────────

export type TurnStatus = "running" | "completed" | "failed" | "skipped"

export interface TurnModel {
  turnId: string
  /** Role badge label source — first unit's compile-time role. */
  role: string
  status: TurnStatus
  taskId?: string
  startedAt?: number
  endedAt?: number
  durationMs?: number
  depth: number
  /** Units in stream order. */
  units: ConversationUnit[]
}

/**
 * Fold the unit stream into turn groups, first-appearance order. Turns
 * may interleave in the stream (concurrent tasks) — units regroup by
 * turnId while keeping stream order inside each turn.
 */
export function groupUnitsByTurn(
  units: ConversationUnit[],
  depth?: Map<string, number>,
): TurnModel[] {
  const depths = depth ?? estimateTurnDepth(units)
  const turns: TurnModel[] = []
  const byId = new Map<string, TurnModel>()

  for (const unit of units) {
    let turn = byId.get(unit.turnId)
    if (!turn) {
      turn = {
        turnId: unit.turnId,
        role: unit.role,
        status: "running",
        depth: depths.get(unit.turnId) ?? 1,
        units: [],
      }
      byId.set(unit.turnId, turn)
      turns.push(turn)
    }
    if (turn.taskId === undefined && unit.taskId !== undefined) turn.taskId = unit.taskId
    if (turn.startedAt === undefined && unit.at !== undefined) turn.startedAt = unit.at
    if (unit.at !== undefined) turn.endedAt = unit.at
    if (unit.kind === "task-status") turn.status = unit.status
    turn.units.push(unit)
  }

  for (const turn of turns) {
    // Duration needs two DISTINCT timestamps — a single `at` on the only
    // unit of a turn is a moment, not a span.
    if (
      turn.startedAt !== undefined &&
      turn.endedAt !== undefined &&
      turn.endedAt > turn.startedAt
    ) {
      turn.durationMs = turn.endedAt - turn.startedAt
    }
  }
  return turns
}

// ── buildConversationFindIndex ──────────────────────────────────────────────

export interface FindHit {
  /** Which searchable field matched ("text", "tool", "input", "error", …). */
  field: string
  start: number
  end: number
}

export interface FindMatch {
  /** Position in the unit stream. */
  unitIndex: number
  key: string
  turnId: string
  kind: ConversationUnitKind
  hits: FindHit[]
}

/** The unit's searchable (field, text) pairs — the find index's corpus. */
export function unitSearchableFields(
  unit: ConversationUnit,
): Array<{ field: string; text: string }> {
  switch (unit.kind) {
    case "text":
      return [{ field: "text", text: unit.text }]
    case "task":
      return [{ field: "taskId", text: unit.taskId }]
    case "tool": {
      const fields = [
        { field: "tool", text: unit.tool },
        { field: "input", text: boundedJson(unit.input) },
      ]
      if (unit.error !== undefined) fields.push({ field: "error", text: unit.error })
      return fields
    }
    case "retry": {
      const fields = [{ field: "phase", text: unit.phase }]
      if (unit.providerId !== undefined) fields.push({ field: "provider", text: unit.providerId })
      if (unit.reason !== undefined) fields.push({ field: "reason", text: unit.reason })
      return fields
    }
    case "permission": {
      const fields = [
        { field: "tool", text: unit.tool },
        { field: "target", text: unit.target ?? "" },
      ]
      if (unit.decision !== undefined) fields.push({ field: "decision", text: unit.decision })
      if (unit.via !== undefined) fields.push({ field: "via", text: unit.via })
      if (unit.reason !== undefined) fields.push({ field: "reason", text: unit.reason })
      return fields
    }
    case "task-status": {
      const fields = [{ field: "taskId", text: unit.taskId }]
      if (unit.error !== undefined) fields.push({ field: "error", text: unit.error })
      return fields
    }
    case "review":
      return unit.summary !== undefined ? [{ field: "summary", text: unit.summary }] : []
    case "failed":
      return [{ field: "error", text: unit.error }]
  }
}

/** All case-insensitive occurrence ranges of `query` in `text`. */
function matchAll(text: string, lowerQuery: string): FindHit[] {
  const hits: FindHit[] = []
  const lower = text.toLowerCase()
  let from = 0
  for (;;) {
    const at = lower.indexOf(lowerQuery, from)
    if (at === -1) break
    hits.push({ field: "", start: at, end: at + lowerQuery.length })
    from = at + Math.max(lowerQuery.length, 1)
  }
  return hits
}

/**
 * Find index for the unit stream (conversationFindIndex borrowing):
 * per unit, every case-insensitive occurrence of the query across its
 * searchable fields — the positions a highlight layer needs. Blank
 * queries yield no matches.
 */
export function buildConversationFindIndex(units: ConversationUnit[], query: string): FindMatch[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const out: FindMatch[] = []
  units.forEach((unit, unitIndex) => {
    const hits: FindHit[] = []
    for (const { field, text } of unitSearchableFields(unit)) {
      for (const hit of matchAll(text, q)) hits.push({ ...hit, field })
    }
    if (hits.length > 0) {
      out.push({ unitIndex, key: unit.key, turnId: unit.turnId, kind: unit.kind, hits })
    }
  })
  return out
}

// ── toConversationMarkdown ──────────────────────────────────────────────────

export interface ConversationMarkdownOpts {
  /** Document title tail (workspace request head, or null). */
  workspaceTitle?: string | null
  /** Append ISO timestamps to unit lines that carry one. */
  includeTimestamps?: boolean
}

function stamp(at: number | undefined, enabled: boolean | undefined): string {
  return enabled && at !== undefined ? ` _(${new Date(at).toISOString()})_` : ""
}

/** One-line markdown for a tool unit — includes exit code when known. */
function toolLine(unit: ToolUnit): string {
  const parts: string[] = [`\`${unit.tool}\``]
  if (unit.state === "running") parts.push("— running")
  if (unit.state === "error") parts.push(`— failed${unit.error ? `: ${unit.error}` : ""}`)
  if (unit.durationMs !== undefined) parts.push(`${unit.durationMs}ms`)
  if (unit.exitCode !== undefined) parts.push(`exit ${unit.exitCode}`)
  return `- ${parts.join(" · ")}`
}

/**
 * Export the unit stream as a shareable markdown document — per-turn
 * grouping, folded retry-wave stats and tool exit codes/durations.
 * Structural labels stay locale-independent (the model layer never
 * calls t()).
 */
export function toConversationMarkdown(
  units: ConversationUnit[],
  opts: ConversationMarkdownOpts = {},
): string {
  const title = opts.workspaceTitle ? ` — ${opts.workspaceTitle}` : ""
  const turns = groupUnitsByTurn(units)
  const toolCount = units.filter((u) => u.kind === "tool").length
  const retryAttempts = units
    .filter((u): u is RetryUnit => u.kind === "retry")
    .reduce((sum, u) => sum + u.attempts, 0)

  const stats = [`${turns.length} turns`, `${units.length} units`, `${toolCount} tool calls`]
  if (retryAttempts > 0) stats.push(`${retryAttempts} retry attempts`)

  const lines: string[] = [`# Maximilian conversation${title}`, "", `_${stats.join(" · ")}_`, ""]

  for (const turn of turns) {
    const head = turn.taskId !== undefined ? `${turn.role} · ${turn.taskId}` : turn.role
    const status =
      turn.turnId.startsWith("task-") && turn.status !== "running" ? ` (${turn.status})` : ""
    lines.push(`## ${head}${status}`, "")
    for (const unit of turn.units) {
      const mark = stamp(unit.at, opts.includeTimestamps)
      switch (unit.kind) {
        case "task":
          break // turn-opening marker — the `## role · taskId` header is it
        case "text":
          if (unit.text.includes("\n")) {
            lines.push(unit.text, "")
          } else {
            lines.push(unit.text + mark, "")
          }
          break
        case "tool":
          lines.push(toolLine(unit) + mark)
          break
        case "retry": {
          const detail = unit.reason !== undefined ? ` — ${unit.reason}` : ""
          lines.push(
            `- retry: ${unit.phase} ×${unit.attempts} · ${unit.totalDelayMs}ms total${detail}${mark}`,
          )
          break
        }
        case "permission": {
          const target = unit.target !== undefined ? ` → ${unit.target}` : ""
          lines.push(`- permission \`${unit.tool}\`${target} — ${unit.state}${mark}`)
          break
        }
        case "task-status":
          lines.push(`- status: ${unit.status}${unit.error ? `: ${unit.error}` : ""}${mark}`)
          break
        case "review":
          lines.push(
            `- review score: ${unit.score ?? "—"}${unit.summary ? ` — ${unit.summary}` : ""}${mark}`,
          )
          break
        case "failed":
          lines.push(`- workspace failed: ${unit.error}${mark}`)
          break
      }
    }
    lines.push("")
  }
  return lines.join("\n")
}

// ── windowTurns (virtualized-window model) ──────────────────────────────────

/** Newest-turn window size when the caller does not pin one. */
export const DEFAULT_WINDOW_TURNS = 30

export interface WindowTurnsOpts {
  /** Window size in turns (default DEFAULT_WINDOW_TURNS). Clamped defensively. */
  visibleTurns?: number
  /** Scroll anchor: pin the window head to this turn id. */
  anchorTurnId?: string | null
  /**
   * Precomputed turn depths (estimateTurnDepth over the FULL unit
   * stream). The window may render a filtered unit subset (find mode) —
   * regrouping that subset alone would re-derive nested depths from
   * missing parents, so the caller can pin the full-stream depths.
   */
  depth?: Map<string, number>
}

export interface TurnWindow {
  /** Turns to render, stream order. */
  turns: TurnModel[]
  /** Turns hidden above the window — the "load earlier" count. */
  hiddenBefore: number
  /** The anchor's position in the FULL turn list; undefined without a hit. */
  anchorOffset?: number
}

/**
 * Conversation windowing (deepseek ui-conversation borrowing): the turn
 * list is a growing stream, so render only a bounded window. Without an
 * anchor the window hugs the TAIL (newest `visibleTurns`); with an
 * anchor turn id the window's head is pinned AT the anchor so the
 * container can scroll to it (anchorOffset = its full-list position).
 * Defensive: empty streams, non-finite / negative / oversized
 * `visibleTurns` all fall back to the default window; an anchor that
 * matches no turn degrades to the tail window.
 */
export function windowTurns(units: ConversationUnit[], opts: WindowTurnsOpts = {}): TurnWindow {
  const turns = groupUnitsByTurn(units, opts.depth)
  if (turns.length === 0) return { turns: [], hiddenBefore: 0, anchorOffset: undefined }

  const requested = opts.visibleTurns
  const visible =
    typeof requested === "number" && Number.isFinite(requested) && requested >= 1
      ? Math.min(Math.floor(requested), turns.length)
      : Math.min(DEFAULT_WINDOW_TURNS, turns.length)

  const anchorId =
    typeof opts.anchorTurnId === "string" && opts.anchorTurnId !== ""
      ? opts.anchorTurnId
      : undefined
  if (anchorId !== undefined) {
    const at = turns.findIndex((turn) => turn.turnId === anchorId)
    if (at >= 0) {
      const end = Math.min(at + visible, turns.length)
      return { turns: turns.slice(at, end), hiddenBefore: at, anchorOffset: at }
    }
  }
  return {
    turns: turns.slice(turns.length - visible),
    hiddenBefore: turns.length - visible,
    anchorOffset: undefined,
  }
}

// ── textUnits (text-segment extraction) ─────────────────────────────────────

/** Where a text segment came from — drives TextUnitBlock styling. */
export type TextUnitSource = "user" | "system" | "steering"

export interface ExtractedTextUnit {
  key: string
  /** Turn (conversation group) the segment belongs to. */
  turnId: string
  role: string
  source: TextUnitSource
  text: string
  taskId?: string
  /** Input-stream position (user request = -1, before the stream). */
  index: number
  at?: number
}

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

/** Event types whose `description` field is task prose worth surfacing. */
const TASK_DESCRIPTION_TYPES = new Set(["task-start", "task-update", "task-description"])

/**
 * Extract the conversation's TEXT segments as standalone units: the
 * workspace user request (source "user"), task description prose and
 * its later revisions (source "system" — same description for a task is
 * a repeat, not a change, and folds away), and steering-injected
 * messages (source "steering", one unit per message, joined to the
 * first steered task's turn). Everything is defensive: garbage events
 * drop, non-string description/message payloads drop, and the user
 * request only appears when a workspace carries one.
 */
export function textUnits(
  events: RuntimeEvent[],
  workspace: Workspace | null = null,
): ExtractedTextUnit[] {
  const units: ExtractedTextUnit[] = []
  /** Last description seen per task — change detection for revisions. */
  const lastDescription = new Map<string, string>()
  const stream = Array.isArray(events) ? events : []

  const userRequest = workspace === null ? undefined : asStr(workspace.userRequest, 8000)
  if (userRequest !== undefined) {
    units.push({
      key: "text-user",
      turnId: "user",
      role: "user",
      source: "user",
      text: userRequest,
      index: -1,
    })
  }

  stream.forEach((raw, index) => {
    const e = asEvent(raw)
    if (!e) return
    const rec = e as Record<string, unknown>
    const at = eventTs(e)

    if (TASK_DESCRIPTION_TYPES.has(e.type)) {
      const taskId = asStr(rec.taskId) ?? ""
      const description = asStr(rec.description, 8000)
      if (description === undefined || lastDescription.get(taskId) === description) return
      lastDescription.set(taskId, description)
      const turnId = taskId !== "" ? `task-${taskId}` : `msg-${index}`
      units.push({
        key: `task-desc-${index}`,
        turnId,
        role: asStr(rec.agentRole, 40) ?? "system",
        source: "system",
        text: description,
        taskId: taskId !== "" ? taskId : undefined,
        index,
        at,
      })
      return
    }

    if (e.type === "steering-applied") {
      const steeredTaskId = asStr(asArray(rec.taskIds)[0]) ?? asStr(rec.taskId) ?? undefined
      const turnId = steeredTaskId !== undefined ? `task-${steeredTaskId}` : SYSTEM_TURN_ID
      asArray(rec.messages).forEach((message, ordinal) => {
        const text = asStr(message, 8000)
        if (text === undefined) return
        units.push({
          key: `steering-${index}-${ordinal}`,
          turnId,
          role: "user",
          source: "steering",
          text,
          taskId: steeredTaskId,
          index,
          at,
        })
      })
    }
  })

  // Stream order (stable: same-index steering messages keep their order).
  units.sort((a, b) => a.index - b.index)
  return units
}

// ── withTextUnitEvents (text units into the render chain) ───────────────────

/**
 * Surface the textUnits output in a render chain that only accepts a
 * RuntimeEvent[] (ChatPanel → ConversationTimeline): every extracted
 * steering/system segment is spliced back into the stream AT ITS SOURCE
 * POSITION as a synthetic text event tagged with TEXT_SOURCE_FIELD, so
 * buildTurnFlowItems compiles it into a `source`-stamped text unit that
 * joins the SAME turn it was steered to — ahead of that turn's later
 * units (the tool calls, statuses and narration that follow it in
 * stream order).
 *
 * The user-source unit is dropped: buildTurnFlowItems already leads
 * with the workspace request, and passing it through would render the
 * request twice. Same-index segments keep textUnits' ordinal order.
 * Pure + defensive: without extractable segments the input array is
 * returned as-is (same reference), and malformed extracted entries
 * cannot occur (textUnits already coerces).
 */
export function withTextUnitEvents(
  events: RuntimeEvent[],
  workspace: Workspace | null = null,
): RuntimeEvent[] {
  const stream = Array.isArray(events) ? events : []
  const extracted = textUnits(stream, workspace).filter((unit) => unit.source !== "user")
  if (extracted.length === 0) return events

  /** Source index → its extracted segments, in ordinal order. */
  const byIndex = new Map<number, ExtractedTextUnit[]>()
  for (const unit of extracted) {
    const batch = byIndex.get(unit.index)
    if (batch) batch.push(unit)
    else byIndex.set(unit.index, [unit])
  }

  const out: RuntimeEvent[] = []
  stream.forEach((event, index) => {
    for (const unit of byIndex.get(index) ?? []) {
      out.push({
        type: "text",
        text: unit.text,
        role: unit.role,
        [TEXT_SOURCE_FIELD]: unit.source,
        ...(unit.taskId !== undefined ? { taskId: unit.taskId } : {}),
        ...(unit.at !== undefined ? { ts: unit.at } : {}),
      })
    }
    out.push(event)
  })
  return out
}

// ── liveTailState (live-tail state machine) ─────────────────────────────────

export interface LiveTailState {
  /** Attached: the rendered window grows with the stream (follow the tail). */
  followsTail: boolean
  /** Units that landed after the freeze point while detached. */
  frozenCount: number
}

export interface LiveTailOpts {
  /** Unit count at detach time — where the tail froze. */
  frozenAt?: number | null
}

/**
 * Live-tail state machine: attached = follow the tail (window keeps
 * growing, nothing pending); detached (the user scrolled up) = freeze
 * the window at `frozenAt` and count the units that arrived since —
 * the "N new" badge a jump-to-latest affordance renders. Detaching
 * without a recorded freeze point freezes at the current end (nothing
 * pending yet). Defensive: non-array streams count as empty; negative /
 * non-finite / oversized frozenAt clamps into range.
 */
export function liveTailState(
  units: ConversationUnit[],
  detached: boolean | undefined,
  opts: LiveTailOpts = {},
): LiveTailState {
  const total = Array.isArray(units) ? units.length : 0
  if (detached !== true) return { followsTail: true, frozenCount: 0 }
  const frozen = asNum(opts.frozenAt)
  const at = frozen === undefined ? total : Math.max(0, Math.min(Math.floor(frozen), total))
  return { followsTail: false, frozenCount: total - at }
}

// ── shareSections (structured share export) ─────────────────────────────────

export interface ShareStats {
  units: number
  texts: number
  tools: number
  retries: number
}

export interface ShareSection {
  turnId: string
  role: string
  taskId?: string
  /** Lifecycle status for task turns; message turns carry none. */
  status?: TurnStatus
  /** Locale-independent heading line ("backend · t1 (completed)"). */
  heading: string
  stats: ShareStats
  /** Markdown body lines (toConversationMarkdown's line format). */
  lines: string[]
  /** Head of the section's first text — list/preview affordances. */
  excerpt: string
}

export interface ShareDocument {
  /** Document title tail (workspace request head, or ""). */
  title: string
  stats: ShareStats & { turns: number }
  sections: ShareSection[]
}

const EXCERPT_LENGTH = 120

function shareStatsOf(sectionUnits: ConversationUnit[]): ShareStats {
  return {
    units: sectionUnits.length,
    texts: sectionUnits.filter((u) => u.kind === "text").length,
    tools: sectionUnits.filter((u) => u.kind === "tool").length,
    retries: sectionUnits
      .filter((u): u is RetryUnit => u.kind === "retry")
      .reduce((sum, u) => sum + u.attempts, 0),
  }
}

function shareUnitLine(unit: ConversationUnit, withStamp: boolean): string | null {
  const mark = stamp(unit.at, withStamp)
  switch (unit.kind) {
    case "task":
      return null // the section heading IS the marker's render
    case "text":
      return unit.text.includes("\n") ? unit.text : unit.text + mark
    case "tool":
      return toolLine(unit) + mark
    case "retry": {
      const detail = unit.reason !== undefined ? ` — ${unit.reason}` : ""
      return `- retry: ${unit.phase} ×${unit.attempts} · ${unit.totalDelayMs}ms total${detail}${mark}`
    }
    case "permission": {
      const target = unit.target !== undefined ? ` → ${unit.target}` : ""
      return `- permission \`${unit.tool}\`${target} — ${unit.state}${mark}`
    }
    case "task-status":
      return `- status: ${unit.status}${unit.error ? `: ${unit.error}` : ""}${mark}`
    case "review":
      return `- review score: ${unit.score ?? "—"}${unit.summary ? ` — ${unit.summary}` : ""}${mark}`
    case "failed":
      return `- workspace failed: ${unit.error}${mark}`
  }
}

/**
 * Structured share model — the per-TURN sections a share preview
 * renders (vs toConversationMarkdown's flat string): heading, per-turn
 * stats, markdown body lines and a text excerpt each. Titles/stamps
 * stay locale-independent; ShareView owns the labels.
 */
export function shareSections(
  units: ConversationUnit[],
  opts: { workspaceTitle?: string | null; includeTimestamps?: boolean } = {},
): ShareDocument {
  const title = opts.workspaceTitle ? opts.workspaceTitle.slice(0, 120) : ""
  const turns = groupUnitsByTurn(units)

  const sections: ShareSection[] = turns.map((turn) => {
    const stats = shareStatsOf(turn.units)
    const status =
      turn.turnId.startsWith("task-") && turn.status !== "running" ? ` (${turn.status})` : ""
    const head = turn.taskId !== undefined ? `${turn.role} · ${turn.taskId}` : turn.role
    const lines: string[] = []
    for (const unit of turn.units) {
      const line = shareUnitLine(unit, opts.includeTimestamps === true)
      if (line !== null) lines.push(line)
    }
    const firstText = turn.units.find((u) => u.kind === "text")
    return {
      turnId: turn.turnId,
      role: turn.role,
      taskId: turn.taskId,
      status: turn.turnId.startsWith("task-") ? turn.status : undefined,
      heading: `${head}${status}`,
      stats,
      lines,
      excerpt:
        firstText && firstText.kind === "text" ? firstText.text.slice(0, EXCERPT_LENGTH) : "",
    }
  })

  const totals = sections.reduce(
    (acc, section) => ({
      units: acc.units + section.stats.units,
      texts: acc.texts + section.stats.texts,
      tools: acc.tools + section.stats.tools,
      retries: acc.retries + section.stats.retries,
    }),
    { units: 0, texts: 0, tools: 0, retries: 0 },
  )
  return { title, stats: { ...totals, turns: sections.length }, sections }
}

/** Render the structured share document as the copy-to-clipboard text. */
export function toShareMarkdown(doc: ShareDocument): string {
  const title = doc.title ? ` — ${doc.title}` : ""
  const s = doc.stats
  const stats = [`${s.turns} turns`, `${s.units} units`, `${s.tools} tool calls`]
  if (s.retries > 0) stats.push(`${s.retries} retry attempts`)
  const lines: string[] = [`# Maximilian conversation${title}`, "", `_${stats.join(" · ")}_`, ""]
  for (const section of doc.sections) {
    lines.push(`## ${section.heading}`, "")
    if (section.lines.length > 0) lines.push(...section.lines.map((line) => `${line}`), "")
  }
  return lines.join("\n")
}

// ── estimateVirtualHeight (virtual-scroll budget) ───────────────────────────

/** Row height a virtualized container assumes when none is given. */
export const VIRTUAL_ROW_HEIGHT = 28
/** Wrap width the text line estimate assumes (columns per row). */
const TEXT_WRAP_COLUMNS = 80

const UNIT_ROW_WEIGHT: Record<ConversationUnitKind, number> = {
  task: 1,
  tool: 2, // folded header + result line
  retry: 2,
  permission: 2,
  "task-status": 1,
  review: 1,
  failed: 1,
  text: 0, // computed from the wrapped-line estimate below
}

/** Rows a text unit occupies: hard breaks plus 80-column wrap estimate. */
function textRowCount(text: string): number {
  return text
    .split("\n")
    .reduce((n, seg) => n + Math.max(1, Math.ceil(seg.length / TEXT_WRAP_COLUMNS)), 0)
}

/** Estimated pixel height of ONE unit; 0 for malformed entries. */
function unitPixelHeight(unit: ConversationUnit, height: number): number {
  if (unit === null || typeof unit !== "object") return 0
  if (unit.kind === "text") return textRowCount(unit.text) * height
  return (UNIT_ROW_WEIGHT[unit.kind] ?? 1) * height
}

/**
 * Per-unit pixel heights, aligned 1:1 with the input stream — the
 * virtualized-window budget a placeholder bar renders per card (its sum
 * IS estimateVirtualHeight). Defensive: malformed entries contribute 0;
 * a missing / non-finite / negative rowHeight falls back to
 * VIRTUAL_ROW_HEIGHT.
 */
export function perItemHeight(
  units: ConversationUnit[],
  rowHeight: number = VIRTUAL_ROW_HEIGHT,
): number[] {
  const height =
    typeof rowHeight === "number" && Number.isFinite(rowHeight) && rowHeight > 0
      ? rowHeight
      : VIRTUAL_ROW_HEIGHT
  if (!Array.isArray(units)) return []
  return units.map((unit) => unitPixelHeight(unit, height))
}

/** Total-pixel threshold above which the timeline surfaces the estimate. */
export const VIRTUAL_HEIGHT_THRESHOLD = 8000

/**
 * Total pixel height a virtualized conversation container needs:
 * per-unit row weights (text scales with wrapped-line estimate), times
 * the row height. Defensive: malformed entries count 0; a missing /
 * non-finite / negative rowHeight falls back to VIRTUAL_ROW_HEIGHT.
 */
export function estimateVirtualHeight(
  units: ConversationUnit[],
  rowHeight: number = VIRTUAL_ROW_HEIGHT,
): number {
  return perItemHeight(units, rowHeight).reduce((sum, h) => sum + h, 0)
}

/**
 * Estimated pixel height of ONE turn: the sum of its units' per-item
 * estimates — the minHeight a timeline card reserves while windowed
 * (anti-jump) and the turn's share of estimateVirtualHeight. Defensive:
 * a malformed turn (null, missing or non-array units) contributes 0;
 * row-height validation matches perItemHeight.
 */
export function turnHeight(
  turn: { units?: ConversationUnit[] } | null | undefined,
  rowHeight: number = VIRTUAL_ROW_HEIGHT,
): number {
  if (turn === null || typeof turn !== "object") return 0
  const units = turn.units
  if (!Array.isArray(units)) return 0
  return perItemHeight(units as ConversationUnit[], rowHeight).reduce((sum, h) => sum + h, 0)
}

/**
 * Human-readable pixel estimate for the windowing affordance: plain
 * pixels under a thousand, one-decimal k-pixels above. Defensive:
 * non-finite / non-positive input collapses to "0 px".
 */
export function formatEstimatedHeight(px: number): string {
  if (!Number.isFinite(px) || px <= 0) return "0 px"
  if (px < 1000) return `${Math.round(px)} px`
  const k = px / 1000
  const value = k >= 100 ? Math.round(k) : Math.round(k * 10) / 10
  return `${value}k px`
}

// ── virtualWindow / scrollOffsetForUnit (true virtual scrolling) ────────────

/**
 * Units rendered beyond each viewport edge when the caller does not pin
 * one — cheap insurance against blank flashes at the window's seams.
 */
export const DEFAULT_VIRTUAL_OVERSCAN = 4

export interface VirtualWindow {
  /** First rendered unit — the window is the half-open range [start, end). */
  start: number
  /** One past the last rendered unit. */
  end: number
  /** Estimated pixel height ABOVE the window (the top fill). */
  padTop: number
  /** Estimated pixel height BELOW the window (the bottom fill). */
  padBottom: number
  /** Estimated pixel height of the whole stream (the spacer's height). */
  total: number
}

/**
 * One coerced entry of a per-unit height estimate: finite positive
 * values pass through; missing / malformed entries fall back to the
 * default row height (perItemHeight never emits those for well-formed
 * units, so this only guards hand-built arrays).
 */
function virtualHeightAt(heights: readonly number[] | undefined, index: number): number {
  const h = heights?.[index]
  return typeof h === "number" && Number.isFinite(h) && h > 0 ? h : VIRTUAL_ROW_HEIGHT
}

/**
 * True virtual scrolling arithmetic (the upgrade of the windowed +
 * placeholder-height rendering): from the per-unit estimated heights
 * and the current scroll position, compute WHICH units are on screen —
 * the half-open [start, end) range — plus the estimated fill heights
 * above and below, so a container can render a total-height spacer
 * with only the visible band absolutely positioned inside it.
 *
 * `units` contributes only its length (any item stream virtualizes);
 * `scrollTop` clamps into [0, total − viewport] so an overshoot hugs
 * the tail and a negative value hugs the head; `overscan` extends the
 * window past each edge, clamped at the stream bounds. Defensive:
 * non-array units count 0; missing / malformed heights fall back to
 * VIRTUAL_ROW_HEIGHT — the same coercion scrollOffsetForUnit applies,
 * so the two functions never disagree about an offset.
 */
export function virtualWindow(
  units: readonly unknown[],
  heights: readonly number[] | undefined,
  scrollTop: number,
  viewportHeight: number,
  overscan: number = DEFAULT_VIRTUAL_OVERSCAN,
): VirtualWindow {
  const count = Array.isArray(units) ? units.length : 0
  const empty: VirtualWindow = { start: 0, end: 0, padTop: 0, padBottom: 0, total: 0 }
  if (count === 0) return empty

  const hs: number[] = []
  let total = 0
  for (let i = 0; i < count; i++) {
    const h = virtualHeightAt(heights, i)
    hs.push(h)
    total += h
  }
  if (total <= 0) return empty

  const over =
    typeof overscan === "number" && Number.isFinite(overscan) && overscan >= 0
      ? Math.floor(overscan)
      : DEFAULT_VIRTUAL_OVERSCAN
  const viewport =
    typeof viewportHeight === "number" && Number.isFinite(viewportHeight) && viewportHeight > 0
      ? viewportHeight
      : 0
  const rawTop = typeof scrollTop === "number" && Number.isFinite(scrollTop) ? scrollTop : 0
  const scroll = Math.max(0, Math.min(rawTop, total - viewport))

  // Prefix sums: cum[i] is unit i's top edge; binary-searched twice.
  const cum = new Array<number>(count + 1)
  cum[0] = 0
  for (let i = 0; i < count; i++) cum[i + 1] = cum[i]! + hs[i]!

  // First unit whose BOTTOM edge lies below the scroll top.
  let start = count
  for (let lo = 0, hi = count - 1; lo <= hi;) {
    const mid = (lo + hi) >> 1
    if (cum[mid + 1]! > scroll) {
      start = mid
      hi = mid - 1
    } else {
      lo = mid + 1
    }
  }
  // First unit whose TOP edge is at/below the viewport bottom.
  let end = count
  for (let lo = start, hi = count - 1; lo <= hi;) {
    const mid = (lo + hi) >> 1
    if (cum[mid]! >= scroll + viewport) {
      end = mid
      hi = mid - 1
    } else {
      lo = mid + 1
    }
  }

  const from = Math.max(0, start - over)
  const to = Math.min(count, end + over)
  return { start: from, end: to, padTop: cum[from]!, padBottom: total - cum[to]!, total }
}

/**
 * The scrollTop that brings unit `unitIndex` to the TOP of the virtual
 * viewport — the sum of the estimated heights above it. The anchor
 * jumps' scroll arithmetic: turn/find navigation maps a target to an
 * index, this maps the index to an offset. Clamps: indexes at/below 0
 * yield 0; indexes at/past the end yield the full height (jump to the
 * tail). Defensive: non-array streams count 0 and malformed / missing
 * heights coerce exactly as virtualWindow coerces them.
 */
export function scrollOffsetForUnit(
  units: readonly unknown[],
  heights: readonly number[] | undefined,
  unitIndex: number,
): number {
  const count = Array.isArray(units) ? units.length : 0
  if (count === 0) return 0
  const index =
    typeof unitIndex === "number" && Number.isFinite(unitIndex) ? Math.floor(unitIndex) : 0
  if (index <= 0) return 0
  const limit = Math.min(index, count)
  let offset = 0
  for (let i = 0; i < limit; i++) offset += virtualHeightAt(heights, i)
  return offset
}

// ── Presentation helpers (pure, shared by the components) ───────────────────

/** Deterministic duration label: "120 ms" under a second, "2.5 s" above. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—"
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(1)} s`
}
