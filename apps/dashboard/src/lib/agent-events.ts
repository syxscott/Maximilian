// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Event-stream derivations for the live agent surfaces (ZCode GUI
 * borrowing: the model-trajectory side pane and the subagent session
 * panes). All three views — per-task trajectory, live agent runs, file
 * change review — derive from the SAME runtime event array the workspace
 * SSE stream already feeds into App state, so there is exactly one data
 * channel and no new backend surface.
 *
 * Pure functions: trivially testable, no React, no fetch.
 */

import type { RuntimeEvent } from "@/api"

/** The dashboard's RuntimeEvent is passthrough-typed — coerce defensively. */
const asString = (v: unknown, max = 120): string | undefined => {
  const s = typeof v === "string" ? v : undefined
  return s === undefined ? undefined : s.slice(0, max)
}
const asBool = (v: unknown): boolean | undefined => (typeof v === "boolean" ? v : undefined)
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

// ── Trajectory (ZCode modelTrajectoryStore borrowing) ───────────────────────

export interface TrajectoryEntry {
  kind: "task" | "tool" | "retry" | "permission" | "steering"
  /** One-line label, already localized by the caller's t() at render. */
  label: string
  /** Short secondary detail (tool duration, retry delay, target path…). */
  detail?: string
  ok?: boolean
  /** Original event type — lets the UI pick an icon/color. */
  event: string
}

/**
 * Chronological trajectory for one task (or the whole workspace when
 * taskId is omitted). Only event types that carry decision-relevant
 * signal are included — heartbeat-ish noise (ledger, workspace-status)
 * is deliberately excluded to keep the pane readable.
 */
export function deriveTrajectory(events: RuntimeEvent[], taskId?: string): TrajectoryEntry[] {
  const inScope = (e: RuntimeEvent): boolean =>
    !("taskId" in e) || typeof e.taskId !== "string" || taskId === undefined || e.taskId === taskId

  const out: TrajectoryEntry[] = []
  for (const e of events) {
    if (!inScope(e)) continue
    switch (e.type) {
      case "task-start":
        out.push({
          kind: "task",
          event: e.type,
          label: `task-start · ${asString(e.agentRole) ?? "general"}`,
          detail: asString(e.taskId),
        })
        break
      case "task-complete":
        out.push({ kind: "task", event: e.type, label: "task-complete", ok: true })
        break
      case "task-failed":
        out.push({
          kind: "task",
          event: e.type,
          label: "task-failed",
          detail: asString(e.error),
          ok: false,
        })
        break
      case "task-skipped":
        out.push({
          kind: "task",
          event: e.type,
          label: "task-skipped",
          detail: asString(e.reason),
          ok: false,
        })
        break
      case "tool-start":
        out.push({ kind: "tool", event: e.type, label: `tool · ${asString(e.toolName) ?? "?"}` })
        break
      case "tool-end":
        out.push({
          kind: "tool",
          event: e.type,
          label: `tool · ${asString(e.toolName) ?? "?"}`,
          detail: `${String(e.durationMs ?? "?")}ms${e.error ? ` · ${asString(e.error, 80)}` : ""}`,
          ok: asBool(e.ok),
        })
        break
      case "llm-retry-status": {
        const phase = asString(e.phase) ?? "waiting"
        out.push({
          kind: "retry",
          event: e.type,
          label: `retry · ${phase}`,
          detail: `attempt ${String(e.attempt ?? "?")}/${String(e.maxAttempts ?? "?")}${
            e.delayMs !== undefined ? ` · ${String(e.delayMs)}ms` : ""
          }`,
          ok: phase !== "exhausted",
        })
        break
      }
      case "permission-request":
        out.push({
          kind: "permission",
          event: e.type,
          label: `permission · ${asString(e.tool) ?? "?"}`,
          detail: asString(e.target, 80),
        })
        break
      case "steering-applied":
        out.push({
          kind: "steering",
          event: e.type,
          label: "steering-applied",
          detail: `${asArray(e.messages).length} → ${asArray(e.taskIds).length}`,
        })
        break
      default:
        break
    }
  }
  return out
}

// ── Live agent runs (ZCode subagent session panes borrowing) ────────────────

export type AgentRunState = "running" | "completed" | "failed" | "skipped"

export interface AgentRunView {
  taskId: string
  agentRole: string
  agentId?: string
  state: AgentRunState
  /** Last tool the agent invoked (name + outcome when it finished). */
  lastTool?: { name: string; ok?: boolean }
  /** A permission prompt is parked for this agent right now. */
  permissionPending: boolean
  /** Count of steering waves applied to this task. */
  steeringCount: number
}

/**
 * Collapse the event stream into one live row per task — the "what are my
 * agents doing right now" view.
 */
export function deriveAgentRuns(events: RuntimeEvent[]): Map<string, AgentRunView> {
  const runs = new Map<string, AgentRunView>()
  const touch = (taskId: string, role?: string): AgentRunView => {
    let run = runs.get(taskId)
    if (!run) {
      run = {
        taskId,
        agentRole: role ?? "general",
        state: "running",
        permissionPending: false,
        steeringCount: 0,
      }
      runs.set(taskId, run)
    }
    return run
  }

  for (const e of events) {
    switch (e.type) {
      case "task-start": {
        const run = touch(asString(e.taskId, 200) ?? "", asString(e.agentRole))
        run.state = "running"
        break
      }
      case "task-complete": {
        const run = touch(asString(e.taskId, 200) ?? "")
        run.state = "completed"
        const meta = (e.result ?? {}) as { metadata?: { agentId?: unknown } }
        const agentId = asString(meta.metadata?.agentId, 200)
        if (agentId) run.agentId = agentId
        break
      }
      case "task-failed":
        touch(asString(e.taskId, 200) ?? "").state = "failed"
        break
      case "task-skipped":
        touch(asString(e.taskId, 200) ?? "").state = "skipped"
        break
      case "tool-end": {
        const run = touch(asString(e.taskId, 200) ?? "")
        run.lastTool = { name: asString(e.toolName) ?? "?", ok: asBool(e.ok) }
        break
      }
      case "permission-request":
        touch(asString(e.taskId, 200) ?? "").permissionPending = true
        break
      case "steering-applied":
        for (const id of asArray(e.taskIds)) {
          if (typeof id === "string") touch(id).steeringCount += 1
        }
        break
      default:
        break
    }
  }
  return runs
}

// ── File-change review (ZCode git-action-menu borrowing) ────────────────────

export interface FileChangeView {
  taskId: string
  tool: string
  input: unknown
}

/**
 * Write-path tool calls (edit/write) from the stream, oldest first — the
 * raw material for the diff review flow. The rendering side feeds each
 * entry through DiffPreview's extractChange (shared extraction with the
 * permission dialog, so the two views can never disagree about a diff).
 */
export function deriveFileChanges(events: RuntimeEvent[]): FileChangeView[] {
  const out: FileChangeView[] = []
  for (const e of events) {
    if (e.type !== "tool-start") continue
    const tool = asString(e.toolName, 40) ?? ""
    if (tool !== "edit" && tool !== "write") continue
    out.push({ taskId: asString(e.taskId, 200) ?? "", tool, input: e.input })
  }
  return out
}
