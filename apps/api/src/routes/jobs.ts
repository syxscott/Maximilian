/**
 * Jobs domain — the first real host for @max/core's PendingSlotManager
 * (hermes cron pending-slot borrowing, packages/core/src/cron-slot.ts).
 *
 *   POST   /api/jobs             Create a job (cron expression or intervalMs)
 *   GET    /api/jobs             List jobs + status
 *   DELETE /api/jobs/{id}        Delete a job
 *   POST   /api/jobs/{id}/trigger   Fire a job once (manual dispatch)
 *   GET    /api/jobs/{id}/slots  Current pending-slot state for the job
 *
 * Slot lifecycle (exactly-once scheduling identity):
 *   1. markPending(`job:{id}`, scheduledAt) BEFORE dispatching,
 *   2. dispatch,
 *   3. clear the slot after dispatch completes.
 * A slot left behind proves the dispatch died mid-flight; startup calls
 * `recoverOrphans()` so every stale slot is recovered EXACTLY ONCE via
 * the normal dispatch path — never N times.
 *
 * EXECUTOR BOUNDARY (dispatch semantics, honest by construction):
 *
 *   payload.kind = "none" (the default)  → record-only. The fire updates
 *     `lastTriggeredAt` + the event log; nothing leaves the process.
 *   payload.kind = "workspace"           → the fire enqueues a REAL job
 *     onto the BullMQ WORKSPACE_QUEUE via the same producer path POST
 *     /api/chat uses (Queue.add("execute", …)). The enqueued data is the
 *     standard WorkspaceJobData shape plus the scheduler's message; the
 *     worker consumes it through its normal WORKSPACE_QUEUE loop (extra
 *     fields are ignored by the current processor — materializing a
 *     workspace FROM the message is the deliberate follow-up).
 *
 * Degradation is equally honest: when the queue is not configured
 * (TASK_QUEUE_ENABLED=false or no REDIS_URL) the workspace dispatch
 * degrades to recording a `dispatched` event with `queued:false
 * (queue unavailable)` instead of pretending anything was sent. A BullMQ
 * add() rejection records a `dispatch-failed` event with the error. The
 * slot's markPending/clear bracket the enqueue either way, so a dead
 * dispatch leaves recoverable evidence (exactly-once semantics).
 *
 * Storage is in-memory (Map<jobId, JobRecord>) like the subscriptions
 * route; durability is a deliberate follow-up (swap the registry's Map
 * for a store, keep the routes unchanged).
 */

import { randomUUID } from "node:crypto"
import { createRoute } from "@hono/zod-openapi"
import type { Context } from "hono"
import { z } from "zod"
import { PendingSlotManager, type PendingSlotPersistence, type PendingSlotRecord } from "@max/core"
import { WORKSPACE_QUEUE } from "@max/queue"
import { ErrorSchema } from "../schemas.js"

// ── Schedule parsing (cron 5-field or plain intervalMs) ────────────────────

export interface CronFields {
  minutes: number[]
  hours: number[]
  daysOfMonth: number[]
  months: number[]
  daysOfWeek: number[]
  /** True when the field was a bare `*` (Vixie cron dom/dow OR-semantics). */
  domWildcard: boolean
  dowWildcard: boolean
}

export type ParsedSchedule =
  { kind: "interval"; intervalMs: number } | { kind: "cron"; fields: CronFields }

export type ScheduleParseResult =
  { ok: true; parsed: ParsedSchedule } | { ok: false; error: string }

const MIN_INTERVAL_MS = 1_000
const MAX_INTERVAL_MS = 365 * 24 * 60 * 60 * 1000

function parseCronField(token: string, min: number, max: number): number[] | null {
  const out = new Set<number>()
  for (const part of token.split(",")) {
    if (part.length === 0) return null
    const [rangePart, stepPart] = part.split("/")
    const step = stepPart !== undefined ? Number(stepPart) : 1
    if (!Number.isInteger(step) || step < 1) return null
    if (stepPart !== undefined && rangePart === undefined) return null
    let lo: number
    let hi: number
    if (rangePart === "*") {
      lo = min
      hi = max
    } else if (rangePart.includes("-")) {
      const [a, b] = rangePart.split("-")
      lo = Number(a)
      hi = Number(b)
      if (!Number.isInteger(lo) || !Number.isInteger(hi)) return null
    } else {
      const v = Number(rangePart)
      if (!Number.isInteger(v)) return null
      lo = v
      hi = stepPart !== undefined ? max : v
    }
    if (lo < min || hi > max || lo > hi) return null
    for (let v = lo; v <= hi; v += step) out.add(v)
  }
  return [...out].sort((a, b) => a - b)
}

/**
 * Parse a schedule string. Pure-digit strings are intervalMs; anything
 * else is treated as a 5-field cron expression (minute hour dom month dow).
 * Named months/weekdays and seconds fields are deliberately unsupported —
 * rejected with an error instead of silently misfiring.
 */
export function parseSchedule(schedule: string): ScheduleParseResult {
  const trimmed = schedule.trim()
  if (trimmed.length === 0) return { ok: false, error: "schedule must not be empty" }

  if (/^\d+$/.test(trimmed)) {
    const intervalMs = Number(trimmed)
    if (intervalMs < MIN_INTERVAL_MS) {
      return { ok: false, error: `intervalMs must be >= ${MIN_INTERVAL_MS}` }
    }
    if (intervalMs > MAX_INTERVAL_MS) {
      return { ok: false, error: `intervalMs must be <= ${MAX_INTERVAL_MS}` }
    }
    return { ok: true, parsed: { kind: "interval", intervalMs } }
  }

  const parts = trimmed.split(/\s+/)
  if (parts.length !== 5) {
    return {
      ok: false,
      error: "cron schedule must have exactly 5 fields (minute hour dom month dow)",
    }
  }
  const minutes = parseCronField(parts[0]!, 0, 59)
  const hours = parseCronField(parts[1]!, 0, 23)
  const daysOfMonth = parseCronField(parts[2]!, 1, 31)
  const months = parseCronField(parts[3]!, 1, 12)
  const daysOfWeek = parseCronField(parts[4]!, 0, 7)
  if (!minutes || !hours || !daysOfMonth || !months || !daysOfWeek) {
    return { ok: false, error: `invalid cron expression: ${trimmed}` }
  }
  // Cron has 7 = Sunday in the wild; normalize to JS getDay() semantics
  // (0 = Sunday) and keep the list sorted.
  const dow = daysOfWeek.filter((d) => d <= 6)
  if (daysOfWeek.includes(7)) dow.push(0)
  dow.sort((a, b) => a - b)
  return {
    ok: true,
    parsed: {
      kind: "cron",
      fields: {
        minutes,
        hours,
        daysOfMonth,
        months,
        daysOfWeek: dow,
        domWildcard: parts[2] === "*",
        dowWildcard: parts[4] === "*",
      },
    },
  }
}

function inList(list: number[], v: number): boolean {
  return list.includes(v)
}

/** Vixie cron day matching: restricted dom/dow use OR, otherwise AND. */
function dayMatches(f: CronFields, d: Date): boolean {
  const domOk = inList(f.daysOfMonth, d.getUTCDate())
  const dowOk = inList(f.daysOfWeek, d.getUTCDay())
  if (!f.domWildcard && !f.dowWildcard) return domOk || dowOk
  return domOk && dowOk
}

/**
 * Next fire time, evaluated in UTC (deterministic across deployment
 * timezones — every timestamp in this API is already ISO/UTC). Day-skips
 * first (cheap), then scans hours/minutes only on matching days, with a
 * hard cap so an impossible date (e.g. `0 0 30 2 *`) returns null
 * instead of spinning forever.
 */
export function nextRunAtMs(parsed: ParsedSchedule, fromMs: number): string | null {
  if (parsed.kind === "interval") {
    return new Date(fromMs + parsed.intervalMs).toISOString()
  }
  const f = parsed.fields
  const startDay = new Date(fromMs)
  startDay.setUTCHours(0, 0, 0, 0)
  const DAY_MS = 24 * 60 * 60 * 1000
  const MAX_DAYS = 366 * 2
  for (let offset = 0; offset < MAX_DAYS; offset++) {
    const day = new Date(startDay.getTime() + offset * DAY_MS)
    if (!inList(f.months, day.getUTCMonth() + 1) || !dayMatches(f, day)) continue
    for (const h of f.hours) {
      for (const m of f.minutes) {
        const candidate = new Date(day)
        candidate.setUTCHours(h, m, 0, 0)
        if (candidate.getTime() > fromMs) return candidate.toISOString()
      }
    }
  }
  return null
}

// ── In-memory registry + slot management ───────────────────────────────────

export type TriggerKind = "manual-trigger" | "scheduled-trigger" | "recovered-trigger"

/** Executor event kinds appended after a trigger entry. */
export type DispatchEventKind = "dispatched" | "dispatch-failed"

export interface JobEventEntry {
  at: string
  kind: TriggerKind | DispatchEventKind
  note?: string
  /** "dispatched" entries: the BullMQ job id when the enqueue succeeded. */
  workspaceJobId?: string | null
  /** "dispatched" entries: false when degraded (queue unavailable). */
  queued?: boolean
  /** "dispatch-failed" entries: the BullMQ add() error message. */
  error?: string
}

export interface JobRecord {
  id: string
  name: string
  /** Raw schedule string as provided (cron expression or intervalMs digits). */
  schedule: string
  scheduleKind: "cron" | "interval"
  intervalMs: number | null
  description: string | null
  payload: unknown
  createdAt: string
  updatedAt: string
  lastTriggeredAt: string | null
  nextRunAt: string | null
  triggerCount: number
  /** Append-only, newest last, capped at MAX_EVENTS_PER_JOB. */
  events: JobEventEntry[]
}

export const MAX_EVENTS_PER_JOB = 50

export interface SlotPersistenceWithKeys extends PendingSlotPersistence {
  keys(): string[]
}

export function createInMemorySlotPersistence(): SlotPersistenceWithKeys {
  const map = new Map<string, PendingSlotRecord>()
  return {
    async get(key) {
      return map.get(key)
    },
    async set(key, value) {
      map.set(key, value)
    },
    async clear(key) {
      map.delete(key)
    },
    keys() {
      return [...map.keys()]
    },
  }
}

/** Slot key namespace — one slot per job. */
export function jobSlotKey(jobId: string): string {
  return `job:${jobId}`
}

// ── Payload + real-dispatch port ─────────────────────────────────────────────

/**
 * Job payload, validated at create time (see `validateJobPayload`):
 *   { kind: "workspace", message, source? } — fires enqueue a real BullMQ
 *     workspace job (see the EXECUTOR BOUNDARY note in the header).
 *   { kind: "none" }                        — record-only (same as no payload).
 * A payload object WITHOUT a kind is a legacy v0 record-only payload and is
 * kept as-is for backward compatibility; it is never dispatched.
 */
export type WorkspaceDispatchPayload = {
  kind: "workspace"
  message: string
  source?: string
}

export type JobPayload = WorkspaceDispatchPayload | { kind: "none" } | Record<string, unknown>

const MAX_PAYLOAD_MESSAGE = 8_000
const MAX_PAYLOAD_SOURCE = 200

export type PayloadValidationResult =
  { ok: true; value: JobPayload | undefined } | { ok: false; error: string }

/**
 * Validate a create-time payload. Undefined/null → record-only (backward
 * compatible default). Non-objects are rejected; an explicit `kind` must be
 * "workspace" or "none"; kind "workspace" requires a non-empty `message`.
 */
export function validateJobPayload(payload: unknown): PayloadValidationResult {
  if (payload === undefined || payload === null) return { ok: true, value: undefined }
  if (typeof payload !== "object" || Array.isArray(payload)) {
    return {
      ok: false,
      error: 'payload must be an object with kind "none" or "workspace"',
    }
  }
  const kind = (payload as { kind?: unknown }).kind
  if (kind === undefined) {
    // Legacy v0 record-only payload — kept verbatim, never dispatched.
    return { ok: true, value: payload as Record<string, unknown> }
  }
  if (kind === "none") return { ok: true, value: payload as { kind: "none" } }
  if (kind !== "workspace") {
    return { ok: false, error: 'payload.kind must be "workspace" or "none"' }
  }
  const message = (payload as { message?: unknown }).message
  if (typeof message !== "string" || message.trim().length === 0) {
    return { ok: false, error: 'payload.message is required (min 1 char) when kind is "workspace"' }
  }
  if (message.length > MAX_PAYLOAD_MESSAGE) {
    return { ok: false, error: `payload.message must be <= ${MAX_PAYLOAD_MESSAGE} chars` }
  }
  const source = (payload as { source?: unknown }).source
  if (source !== undefined) {
    if (
      typeof source !== "string" ||
      source.trim().length === 0 ||
      source.length > MAX_PAYLOAD_SOURCE
    ) {
      return { ok: false, error: `payload.source must be a 1-${MAX_PAYLOAD_SOURCE} char string` }
    }
  }
  return { ok: true, value: payload as WorkspaceDispatchPayload }
}

/**
 * Defensive read side: which executor path does a stored payload take?
 * Returns the workspace dispatch payload only when it is fully valid —
 * anything else (none/legacy/malformed) is record-only by construction.
 */
export function asDispatchPayload(payload: unknown): WorkspaceDispatchPayload | null {
  const result = validateJobPayload(payload)
  if (!result.ok) return null
  const value = result.value
  if (value !== undefined && (value as WorkspaceDispatchPayload).kind === "workspace") {
    return value as WorkspaceDispatchPayload
  }
  return null
}

/** Data enqueued onto the BullMQ WORKSPACE_QUEUE for one scheduled fire. */
export interface ScheduledWorkspaceJobData {
  /** Deterministic per-fire target (`ws-sched-<jobId>-<n>`); the worker's
   * normal consumer reads it — today it skips unknown workspaces, and
   * materializing a workspace from `message` is the planned follow-up. */
  workspaceId: string
  mode: "commander"
  /** The scheduler's instruction (payload.message). */
  message: string
  /** Optional payload.source passthrough. */
  source?: string
  /** The firing job — lets the worker correlate back to /jobs. */
  jobId: string
  /** ISO instant of the fire. */
  scheduledAt: string
}

/**
 * Minimal producer port over the BullMQ workspace queue (the API's own
 * `Queue.add("execute", …)` path, passed in by index.ts). Untyped return —
 * only the BullMQ job id is consumed.
 */
export interface JobsQueuePort {
  /** False when the queue is not configured → dispatch degrades honestly. */
  readonly available: boolean
  add(data: ScheduledWorkspaceJobData): Promise<{ id?: string }>
}

/** Deterministic per-fire workspace id for a scheduled fire. */
export function scheduledWorkspaceId(jobId: string, fireCount: number): string {
  return `ws-sched-${jobId}-${fireCount}`
}

export interface JobCreateInput {
  name: string
  schedule: string
  description?: string
  payload?: unknown
}

export interface RecoveredSlot {
  key: string
  jobId: string | null
  dispatched: boolean
  reason: string
}

export interface JobsRegistryOptions {
  now?: () => number
  idFactory?: () => string
  persistence?: SlotPersistenceWithKeys
  /** Wall-clock period of the auto-fire ticker (default 1s). */
  schedulerTickMs?: number
  /**
   * BullMQ workspace-queue producer port. When absent/unavailable,
   * kind=workspace fires degrade to a recorded `dispatched` event with
   * queued:false — the same honest boundary as TASK_QUEUE_ENABLED=false.
   */
  queue?: JobsQueuePort
}

export interface JobsRegistry {
  create(input: JobCreateInput): { ok: true; job: JobRecord } | { ok: false; error: string }
  list(): JobRecord[]
  get(id: string): JobRecord | undefined
  remove(id: string): boolean
  /**
   * Fire a job once through the pending-slot lifecycle:
   * markPending → dispatch (real BullMQ enqueue for kind=workspace
   * payloads, record-only otherwise) → clear.
   */
  trigger(id: string, kind?: TriggerKind): Promise<JobRecord | undefined>
  /** Current pending slot for a job, if the manager holds one. */
  slotFor(id: string): Promise<PendingSlotRecord | undefined>
  /**
   * Startup orphan sweep: every slot left behind by a dead dispatch is
   * recovered EXACTLY ONCE via the normal dispatch path.
   */
  recoverOrphans(): Promise<RecoveredSlot[]>
  /** Fire every job whose nextRunAt is due. Returns the fired count. */
  tick(): Promise<number>
  startScheduler(): void
  stopScheduler(): void
}

export function createJobsRegistry(options: JobsRegistryOptions = {}): JobsRegistry {
  const now = options.now ?? Date.now
  const idFactory = options.idFactory ?? (() => `job_${randomUUID().slice(0, 8)}`)
  const persistence = options.persistence ?? createInMemorySlotPersistence()
  const slots = new PendingSlotManager(persistence, { now })
  const queue = options.queue
  const jobs = new Map<string, JobRecord>()
  let scheduler: ReturnType<typeof setInterval> | undefined
  let ticking = false

  async function tick(): Promise<number> {
    if (ticking) return 0
    ticking = true
    try {
      const ts = now()
      let fired = 0
      for (const job of jobs.values()) {
        if (job.nextRunAt !== null && Date.parse(job.nextRunAt) <= ts) {
          const done = await dispatch(job.id, "scheduled-trigger")
          if (done) fired += 1
        }
      }
      return fired
    } finally {
      ticking = false
    }
  }

  function pushEvent(job: JobRecord, entry: JobEventEntry): void {
    job.events.push(entry)
    if (job.events.length > MAX_EVENTS_PER_JOB) {
      job.events.splice(0, job.events.length - MAX_EVENTS_PER_JOB)
    }
  }

  function computeNextRun(job: JobRecord): string | null {
    const parsed = parseSchedule(job.schedule)
    if (!parsed.ok) return null
    return nextRunAtMs(parsed.parsed, now())
  }

  /**
   * The executor step of a fire. kind=workspace payloads enqueue a real
   * BullMQ workspace job (or degrade honestly when the queue is missing /
   * add() fails); everything else stays record-only. Runs INSIDE the
   * slot's mark/clear bracket so a dead enqueue leaves recoverable
   * evidence (exactly-once semantics).
   */
  async function runExecutor(job: JobRecord, at: string): Promise<void> {
    const payload = asDispatchPayload(job.payload)
    if (payload === null) {
      // kind "none" / legacy payload — record-only by configuration.
      pushEvent(job, {
        at,
        kind: "dispatched",
        queued: false,
        note: 'record-only (payload.kind="none" or absent — no dispatch configured)',
      })
      return
    }
    if (!queue || !queue.available) {
      pushEvent(job, {
        at,
        kind: "dispatched",
        queued: false,
        note: "queued:false (queue unavailable) — workspace dispatch degraded to record-only",
      })
      return
    }
    const data: ScheduledWorkspaceJobData = {
      workspaceId: scheduledWorkspaceId(job.id, job.triggerCount),
      mode: "commander",
      message: payload.message,
      jobId: job.id,
      scheduledAt: at,
      ...(payload.source !== undefined ? { source: payload.source } : {}),
    }
    try {
      const enqueued = await queue.add(data)
      const workspaceJobId = enqueued?.id ?? null
      pushEvent(job, {
        at,
        kind: "dispatched",
        queued: true,
        workspaceJobId,
        note: `queued:${workspaceJobId ?? "no-id"} on ${WORKSPACE_QUEUE} (${data.workspaceId})`,
      })
    } catch (err) {
      pushEvent(job, {
        at,
        kind: "dispatch-failed",
        error: err instanceof Error ? err.message : String(err),
        note: "BullMQ add failed — fire recorded but NOT enqueued (slot recovered by design)",
      })
    }
  }

  async function dispatch(
    id: string,
    kind: TriggerKind,
    note?: string,
  ): Promise<JobRecord | undefined> {
    const job = jobs.get(id)
    if (!job) return undefined
    // Persist-first (the whole point of the slot pattern): a crash after
    // this line leaves recoverable evidence instead of silently losing
    // the fire.
    const at = new Date(now()).toISOString()
    await slots.markPending(jobSlotKey(id), at)
    job.lastTriggeredAt = at
    job.triggerCount += 1
    job.nextRunAt = computeNextRun(job)
    pushEvent(job, { at, kind, ...(note ? { note } : {}) })
    // Executor step — still inside the mark/clear bracket.
    await runExecutor(job, at)
    await slots.clear(jobSlotKey(id))
    return job
  }

  return {
    create(input) {
      const parsed = parseSchedule(input.schedule)
      if (!parsed.ok) return { ok: false, error: parsed.error }
      const payload = validateJobPayload(input.payload)
      if (!payload.ok) return { ok: false, error: payload.error }
      const ts = new Date(now()).toISOString()
      const job: JobRecord = {
        id: idFactory(),
        name: input.name,
        schedule: input.schedule.trim(),
        scheduleKind: parsed.parsed.kind,
        intervalMs: parsed.parsed.kind === "interval" ? parsed.parsed.intervalMs : null,
        description: input.description ?? null,
        payload: payload.value,
        createdAt: ts,
        updatedAt: ts,
        lastTriggeredAt: null,
        nextRunAt: null,
        triggerCount: 0,
        events: [],
      }
      job.nextRunAt = computeNextRun(job)
      jobs.set(job.id, job)
      return { ok: true, job }
    },

    list() {
      return [...jobs.values()].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
    },

    get(id) {
      return jobs.get(id)
    },

    remove(id) {
      const job = jobs.get(id)
      if (!job) return false
      jobs.delete(id)
      // A dead job must not leave an armed slot behind.
      void slots.clear(jobSlotKey(id))
      return true
    },

    async trigger(id, kind = "manual-trigger") {
      return dispatch(id, kind)
    },

    async slotFor(id) {
      return slots.peek(jobSlotKey(id))
    },

    async recoverOrphans() {
      const results: RecoveredSlot[] = []
      for (const key of persistence.keys()) {
        const jobId = key.startsWith("job:") ? key.slice(4) : null
        if (jobId === null) {
          // Not our namespace — leave foreign keys alone.
          continue
        }
        const decision = await slots.recoverOnce(key)
        if (decision.shouldDispatch) {
          const dispatched = await dispatch(
            jobId,
            "recovered-trigger",
            `orphan slot recovered exactly once (original fire at ${decision.record?.scheduledAt ?? "unknown"})`,
          )
          if (!dispatched) {
            // Job no longer exists — an armed slot for a dead job must not
            // survive the sweep (the job delete path already clears, this
            // covers a crash between markPending and delete).
            await slots.clear(key)
          }
        }
        results.push({
          key,
          jobId,
          dispatched: decision.shouldDispatch,
          reason: decision.reason,
        })
      }
      return results
    },

    /** Fire every job whose nextRunAt is due. Returns the fired count. */
    tick: () => tick(),

    startScheduler() {
      if (scheduler !== undefined) return
      scheduler = setInterval(() => {
        void tick()
      }, options.schedulerTickMs ?? 1_000)
      // The ticker must never hold the process open on its own.
      scheduler.unref?.()
    },

    stopScheduler() {
      if (scheduler !== undefined) {
        clearInterval(scheduler)
        scheduler = undefined
      }
    },
  }
}

// ── OpenAPI schemas ─────────────────────────────────────────────────────────

/**
 * Mirrors `validateJobPayload` for the HTTP contract: kind defaults to
 * "none" (record-only) when omitted; kind=workspace requires message.
 */
export const JobPayloadSchema = z
  .object({
    /** "workspace" = fires enqueue a real BullMQ workspace job; "none" = record-only. */
    kind: z.enum(["workspace", "none"]).optional(),
    /** Required when kind = "workspace" — the instruction the fire carries. */
    message: z.string().min(1).max(8_000).optional(),
    /** Optional provenance passthrough on the enqueued job. */
    source: z.string().min(1).max(200).optional(),
  })
  .passthrough()
  .superRefine((val, ctx) => {
    if (
      val.kind === "workspace" &&
      (val.message === undefined || val.message.trim().length === 0)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["message"],
        message: 'message is required (min 1 char) when payload.kind = "workspace"',
      })
    }
  })

export const JobCreateSchema = z.object({
  name: z.string().min(1).max(120),
  /** Cron expression (5 fields) or intervalMs as a digit string. */
  schedule: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  payload: JobPayloadSchema.optional(),
})

export const JobEventSchema = z.object({
  at: z.string(),
  kind: z.string(),
  note: z.string().optional(),
  /** "dispatched" entries: BullMQ job id when the enqueue succeeded. */
  workspaceJobId: z.string().nullable().optional(),
  /** "dispatched" entries: false when degraded (queue unavailable). */
  queued: z.boolean().optional(),
  /** "dispatch-failed" entries: the BullMQ add() error message. */
  error: z.string().optional(),
})

export const JobSchema = z.object({
  id: z.string(),
  name: z.string(),
  schedule: z.string(),
  scheduleKind: z.enum(["cron", "interval"]),
  intervalMs: z.number().nullable(),
  description: z.string().nullable(),
  payload: z.unknown().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastTriggeredAt: z.string().nullable(),
  nextRunAt: z.string().nullable(),
  triggerCount: z.number(),
  events: z.array(JobEventSchema),
})

export const JobListResponseSchema = z.object({
  jobs: z.array(JobSchema),
  total: z.number(),
})

export const JobTriggerResponseSchema = z.object({
  ok: z.boolean(),
  job: JobSchema,
})

export const JobSlotsResponseSchema = z.object({
  jobId: z.string(),
  hasPendingSlot: z.boolean(),
  slot: z
    .object({
      scheduledAt: z.string(),
      at: z.string(),
      by: z.string(),
    })
    .optional(),
})

export const IdParamsSchema = z.object({ id: z.string().min(1) })

// ── OpenAPI route definitions ───────────────────────────────────────────────

export const jobCreateRoute = createRoute({
  method: "post",
  path: "/jobs",
  tags: ["jobs"],
  request: { body: { content: { "application/json": { schema: JobCreateSchema } } } },
  responses: {
    201: {
      content: { "application/json": { schema: JobSchema } },
      description: "Job created",
    },
    400: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Invalid body or schedule",
    },
  },
})

export const jobListRoute = createRoute({
  method: "get",
  path: "/jobs",
  tags: ["jobs"],
  responses: {
    200: {
      content: { "application/json": { schema: JobListResponseSchema } },
      description: "All jobs with status",
    },
  },
})

export const jobDeleteRoute = createRoute({
  method: "delete",
  path: "/jobs/{id}",
  tags: ["jobs"],
  request: { params: IdParamsSchema },
  responses: {
    204: { description: "Job deleted" },
    404: { content: { "application/json": { schema: ErrorSchema } }, description: "Unknown job" },
  },
})

export const jobTriggerRoute = createRoute({
  method: "post",
  path: "/jobs/{id}/trigger",
  tags: ["jobs"],
  request: { params: IdParamsSchema },
  responses: {
    200: {
      content: { "application/json": { schema: JobTriggerResponseSchema } },
      description:
        "Trigger dispatched — real BullMQ workspace enqueue for kind=workspace payloads, honest record-only degradation otherwise",
    },
    404: { content: { "application/json": { schema: ErrorSchema } }, description: "Unknown job" },
  },
})

export const jobSlotsRoute = createRoute({
  method: "get",
  path: "/jobs/{id}/slots",
  tags: ["jobs"],
  request: { params: IdParamsSchema },
  responses: {
    200: {
      content: { "application/json": { schema: JobSlotsResponseSchema } },
      description: "Pending-slot state for the job",
    },
    404: { content: { "application/json": { schema: ErrorSchema } }, description: "Unknown job" },
  },
})

// ── Handlers (plain Context functions, index.ts registers with auth) ────────

export function jobsRoutes(deps: { registry: JobsRegistry }) {
  const { registry } = deps

  return {
    create: async (c: Context) => {
      const body = c.req.valid("json" as never) as {
        name: string
        schedule: string
        description?: string
        payload?: unknown
      }
      const result = registry.create(body)
      if (!result.ok) {
        return c.json({ error: result.error }, 400)
      }
      return c.json(result.job, 201)
    },

    list: async (c: Context) => {
      const jobs = registry.list()
      return c.json({ jobs, total: jobs.length })
    },

    remove: async (c: Context) => {
      const { id } = c.req.valid("param" as never) as { id: string }
      const ok = registry.remove(id)
      if (!ok) return c.json({ error: `Unknown job: ${id}` }, 404)
      return c.body(null, 204)
    },

    trigger: async (c: Context) => {
      const { id } = c.req.valid("param" as never) as { id: string }
      if (!registry.get(id)) {
        return c.json({ error: `Unknown job: ${id}` }, 404)
      }
      const job = await registry.trigger(id, "manual-trigger")
      if (!job) return c.json({ error: `Unknown job: ${id}` }, 404)
      return c.json({ ok: true, job })
    },

    slots: async (c: Context) => {
      const { id } = c.req.valid("param" as never) as { id: string }
      if (!registry.get(id)) {
        return c.json({ error: `Unknown job: ${id}` }, 404)
      }
      const slot = await registry.slotFor(id)
      return c.json({
        jobId: id,
        hasPendingSlot: slot !== undefined,
        ...(slot ? { slot } : {}),
      })
    },
  }
}
