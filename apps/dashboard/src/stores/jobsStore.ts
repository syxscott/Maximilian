// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Jobs store (ZCode tasks-list borrowing): the scheduled / background
 * job list view state — the jobs themselves plus sort and filter. The
 * dashboard never polls jobs itself; the caller (a react-query
 * subscription or the App-level event bus) injects fresh arrays via
 * setJobs, so this store stays a pure state holder. Incoming payloads
 * are passthrough JSON — parseJobs is defensive and drops malformed
 * entries instead of trusting them.
 */
import { create } from "zustand"
import { useShallow } from "zustand/react/shallow"
import { useNotificationStore } from "@/stores/notificationStore"

export type JobKind = "scheduled" | "background"
export type JobState = "idle" | "running" | "succeeded" | "failed"
export type JobSortKey = "nextRunAt" | "lastRunAt" | "name"
export type JobFilter = "all" | "running" | "failed"

export interface JobRecord {
  id: string
  name: string
  kind: JobKind
  state: JobState
  /** Epoch ms of the most recent run, when the producer knows one. */
  lastRunAt?: number
  /** Epoch ms of the next scheduled run (scheduled jobs only). */
  nextRunAt?: number
  /** Duration of the last run in ms. */
  durationMs?: number
  /** Failure detail when state === "failed". */
  error?: string
}

export const JOB_FILTERS: readonly JobFilter[] = ["all", "running", "failed"]

const JOB_STATES: readonly JobState[] = ["idle", "running", "succeeded", "failed"]
const JOB_KINDS: readonly JobKind[] = ["scheduled", "background"]
const SORT_KEYS: readonly JobSortKey[] = ["nextRunAt", "lastRunAt", "name"]

function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback
}

/** Epoch-or-nothing: passthrough timestamps arrive as numbers or ISO strings. */
function epoch(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v
  if (typeof v === "string" && v !== "") {
    const parsed = Date.parse(v)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

/**
 * Defensive parse of one passthrough job entry — null for junk so the
 * array-level filter can drop it.
 */
export function parseJob(value: unknown): JobRecord | null {
  if (value === null || typeof value !== "object") return null
  const o = value as Record<string, unknown>
  const id = typeof o.id === "string" && o.id !== "" ? o.id.slice(0, 200) : null
  const name = typeof o.name === "string" && o.name !== "" ? o.name.slice(0, 200) : null
  if (!id || !name) return null
  const state = oneOf(o.state, JOB_STATES, "idle")
  const error =
    state === "failed" && typeof o.error === "string" && o.error !== ""
      ? o.error.slice(0, 300)
      : undefined
  const durationMs =
    typeof o.durationMs === "number" && Number.isFinite(o.durationMs) ? o.durationMs : undefined
  return {
    id,
    name,
    kind: oneOf(o.kind, JOB_KINDS, "background"),
    state,
    ...(epoch(o.lastRunAt) !== undefined ? { lastRunAt: epoch(o.lastRunAt) } : {}),
    ...(epoch(o.nextRunAt) !== undefined ? { nextRunAt: epoch(o.nextRunAt) } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(error !== undefined ? { error } : {}),
  }
}

/** Defensive parse of a whole jobs payload (array or {jobs: []}). */
export function parseJobs(value: unknown): JobRecord[] {
  const list = Array.isArray(value)
    ? value
    : value !== null &&
        typeof value === "object" &&
        Array.isArray((value as { jobs?: unknown }).jobs)
      ? (value as { jobs: unknown[] }).jobs
      : []
  const out: JobRecord[] = []
  const seen = new Set<string>()
  for (const entry of list) {
    const job = parseJob(entry)
    if (job && !seen.has(job.id)) {
      seen.add(job.id)
      out.push(job)
    }
  }
  return out
}

/** Pure filter: "all" passthrough, otherwise keep matching states. */
export function filterJobs(jobs: readonly JobRecord[], filter: JobFilter): JobRecord[] {
  if (filter === "all") return [...jobs]
  return jobs.filter((j) => j.state === filter)
}

/** Pure sort — name is alphabetic, timestamps are numeric (missing last). */
export function sortJobs(jobs: readonly JobRecord[], key: JobSortKey, asc: boolean): JobRecord[] {
  const dir = asc ? 1 : -1
  return [...jobs].sort((a, b) => {
    if (key === "name") return a.name.localeCompare(b.name) * dir
    const av = key === "nextRunAt" ? a.nextRunAt : a.lastRunAt
    const bv = key === "nextRunAt" ? b.nextRunAt : b.lastRunAt
    if (av === undefined && bv === undefined) return 0
    if (av === undefined) return 1 // jobs without a timestamp sink regardless of direction
    if (bv === undefined) return -1
    return (av - bv) * dir
  })
}

/**
 * Did this snapshot record a FINISHED run for a previously-known job?
 * True when the lastRun timestamp advanced or a running job reached a
 * terminal state. Brand-new ids (first sighting = creation, notified by
 * the jobs domain section) and unchanged re-injected snapshots are not
 * trigger completions.
 */
export function jobRunFinished(prev: JobRecord | undefined, next: JobRecord): boolean {
  if (!prev) return false
  if (
    next.lastRunAt !== undefined &&
    (prev.lastRunAt === undefined || next.lastRunAt > prev.lastRunAt)
  ) {
    return true
  }
  return prev.state === "running" && (next.state === "succeeded" || next.state === "failed")
}

interface JobsState {
  jobs: JobRecord[]
  sortKey: JobSortKey
  sortAsc: boolean
  filter: JobFilter
  /** Replace the whole job list (caller-injected snapshot). */
  setJobs: (payload: unknown) => void
  setSort: (key: JobSortKey) => void
  setFilter: (filter: JobFilter) => void
  clear: () => void
}

export const useJobsStore = create<JobsState>((set, get) => ({
  jobs: [],
  sortKey: "nextRunAt",
  sortAsc: true,
  filter: "all",
  setJobs: (payload) => {
    const next = parseJobs(payload)
    // Real trigger-completion notifications: diff the snapshot against
    // the previous one and push through notificationStore (ToastHost
    // + durable list) when a known job finished a run. Done outside the
    // set() updater so the notification store write never nests.
    const prevById = new Map(get().jobs.map((j) => [j.id, j]))
    for (const job of next) {
      if (!jobRunFinished(prevById.get(job.id), job)) continue
      if (job.state === "failed") {
        useNotificationStore.getState().push("error", "shell.notify.jobRunFailed", {
          name: job.name,
          // The {error} placeholder is always substituted (t() leaves
          // unknown placeholders literal) — empty when no detail exists.
          error: job.error ? `: ${job.error.slice(0, 120)}` : "",
        })
      } else {
        useNotificationStore.getState().push("success", "shell.notify.jobTriggered", {
          name: job.name,
        })
      }
    }
    set({ jobs: next })
  },
  setSort: (key) =>
    set((s) => ({
      // Clicking the active column flips direction; a new column starts asc.
      sortKey: SORT_KEYS.includes(key) ? key : s.sortKey,
      sortAsc: s.sortKey === key ? !s.sortAsc : true,
    })),
  setFilter: (filter) => set({ filter: JOB_FILTERS.includes(filter) ? filter : "all" }),
  clear: () => set({ jobs: [] }),
}))

// ── Selector hooks ──────────────────────────────────────────────────────────

/** The visible list: filter first, then sort. */
export const selectVisibleJobs = (s: JobsState): JobRecord[] =>
  sortJobs(filterJobs(s.jobs, s.filter), s.sortKey, s.sortAsc)

export const useVisibleJobs = (): JobRecord[] =>
  // selectVisibleJobs builds a fresh array per call — useShallow keeps the
  // zustand subscription stable when the visible list is unchanged.
  useJobsStore(useShallow(selectVisibleJobs))

export const useJobsFilter = (): JobFilter => useJobsStore((s) => s.filter)
