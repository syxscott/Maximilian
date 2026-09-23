// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Session projection store (ZCode session-store borrowing): one zustand
 * store holding the workspace's RuntimeEvent[] plus its derived
 * projection — chat-style turns, last activity timestamp and the set of
 * tasks currently running. The derivation reuses lib/agent-events so the
 * projection can never disagree with the trajectory / live-runs panes.
 *
 * Components subscribe through the selector hooks; setEvents /
 * appendEvent are the only write paths.
 */
import { create } from "zustand"
import type { RuntimeEvent } from "@/api"
import { deriveAgentRuns } from "@/lib/agent-events"

// ── Model: events → projection (pure, defensive) ────────────────────────────

export interface SessionTurn {
  /** Task id when the turn is task-backed, otherwise a synthesized id. */
  id: string
  /** Author role — "assistant" unless the event carries a role/agentRole. */
  role: string
  /** One-line preview, ≤120 chars, falls back to the event type. */
  preview: string
  /** Tool invocations observed inside the turn. */
  toolCount: number
}

export interface SessionProjection {
  turns: SessionTurn[]
  /** Epoch ms of the newest timestamped event, null when none carry ts. */
  lastEventAt: number | null
  /** Task ids whose latest lifecycle state is "running". */
  runningTaskIds: string[]
}

const PREVIEW_MAX = 120

const boundedString = (v: unknown, max: number): string | undefined =>
  typeof v === "string" && v.length > 0 ? v.slice(0, max) : undefined

/** Extract the first human-readable text field the event happens to carry. */
function eventText(e: RuntimeEvent): string | undefined {
  const o = e as Record<string, unknown>
  return boundedString(o.text, PREVIEW_MAX) ?? boundedString(o.message, PREVIEW_MAX)
}

/** Coerce a passthrough timestamp (epoch number or ISO string) to ms. */
function eventTs(e: RuntimeEvent): number | undefined {
  const raw = (e as Record<string, unknown>).ts
  if (typeof raw === "number" && Number.isFinite(raw)) return raw
  if (typeof raw === "string" && raw !== "") {
    const parsed = Date.parse(raw)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

/** Project a full event array into turns + activity signals. */
export function projectSession(events: RuntimeEvent[]): SessionProjection {
  interface InternalTurn extends SessionTurn {
    /** Event type of first sight — preview fallback when no text arrives. */
    fallbackType: string
  }

  const turns: InternalTurn[] = []
  const byId = new Map<string, InternalTurn>()

  const touch = (id: string, role: string, fallbackType: string): InternalTurn => {
    let turn = byId.get(id)
    if (!turn) {
      turn = { id, role, preview: "", toolCount: 0, fallbackType }
      byId.set(id, turn)
      turns.push(turn)
    }
    return turn
  }

  let lastEventAt: number | null = null

  events.forEach((e, i) => {
    const ts = eventTs(e)
    if (ts !== undefined && (lastEventAt === null || ts > lastEventAt)) lastEventAt = ts

    const o = e as Record<string, unknown>
    const taskId = boundedString(o.taskId, 200)
    const text = eventText(e)
    const role = boundedString(o.role, 32) ?? boundedString(o.agentRole, 32) ?? "assistant"

    if (taskId) {
      const turn = touch(taskId, role, e.type)
      if (e.type === "tool-start" || e.type === "tool-end") turn.toolCount += 1
      if (text && turn.preview === "") turn.preview = text
    } else if (text) {
      // Text-bearing event without a task id (e.g. a plain assistant
      // message) forms its own turn keyed by arrival index.
      touch(`msg-${i}`, role, e.type).preview = text
    }
  })

  const runningTaskIds: string[] = []
  for (const [taskId, run] of deriveAgentRuns(events)) {
    if (run.state === "running" && taskId !== "") runningTaskIds.push(taskId)
  }

  return {
    turns: turns.map(({ fallbackType, ...rest }) => ({
      ...rest,
      preview: rest.preview || fallbackType,
    })),
    lastEventAt,
    runningTaskIds,
  }
}

// ── Store ───────────────────────────────────────────────────────────────────

interface SessionProjectionState {
  events: RuntimeEvent[]
  projection: SessionProjection
  /** Replace the whole event array (initial hydrate / refetch). */
  setEvents: (events: RuntimeEvent[]) => void
  /** Append one live-stream event. */
  appendEvent: (event: RuntimeEvent) => void
}

const EMPTY_PROJECTION: SessionProjection = { turns: [], lastEventAt: null, runningTaskIds: [] }

export const useSessionProjectionStore = create<SessionProjectionState>((set) => ({
  events: [],
  projection: EMPTY_PROJECTION,
  setEvents: (events) => set({ events, projection: projectSession(events) }),
  appendEvent: (event) =>
    set((s) => {
      const events = [...s.events, event]
      return { events, projection: projectSession(events) }
    }),
}))

// ── Selector hooks ──────────────────────────────────────────────────────────

export const useSessionTurns = (): SessionTurn[] =>
  useSessionProjectionStore((s) => s.projection.turns)

export const useLastEventAt = (): number | null =>
  useSessionProjectionStore((s) => s.projection.lastEventAt)

export const useRunningTaskIds = (): string[] =>
  useSessionProjectionStore((s) => s.projection.runningTaskIds)
