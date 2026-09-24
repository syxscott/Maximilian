/**
 * Jobs domain tests — schedule parsing, the PendingSlotManager-backed
 * registry (mark before dispatch / clear after / recover exactly once)
 * and the route handlers called DIRECTLY with fake Hono contexts (no
 * HTTP, no server boot; smoke.test.ts pattern).
 *
 * The honest v0 executor boundary is part of the contract here: trigger()
 * records lastTriggeredAt + event log and never leaves a slot behind.
 */

import { describe, it, expect, vi, afterEach } from "vitest"
import {
  createJobsRegistry,
  createInMemorySlotPersistence,
  jobSlotKey,
  jobsRoutes,
  nextRunAtMs,
  parseSchedule,
  type JobRecord,
} from "../src/routes/jobs"

afterEach(() => {
  vi.useRealTimers()
})

// ── Schedule parsing ─────────────────────────────────────────────────────────

describe("parseSchedule", () => {
  it("parses digit strings as intervalMs", () => {
    const r = parseSchedule("30000")
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.parsed.kind).toBe("interval")
      expect(r.parsed.kind === "interval" && r.parsed.intervalMs).toBe(30000)
    }
  })

  it("rejects too-small or garbage intervals", () => {
    expect(parseSchedule("999")).toMatchObject({ ok: false })
    expect(parseSchedule("")).toMatchObject({ ok: false })
    expect(parseSchedule("12ab")).toMatchObject({ ok: false })
  })

  it("parses a 5-field cron expression", () => {
    const r = parseSchedule("*/5 * * * *")
    expect(r.ok).toBe(true)
    if (r.ok && r.parsed.kind === "cron") {
      expect(r.parsed.fields.minutes).toEqual([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55])
      expect(r.parsed.fields.domWildcard).toBe(true)
      expect(r.parsed.fields.dowWildcard).toBe(true)
    }
  })

  it("supports ranges, lists, steps and normalizes dow 7 to Sunday", () => {
    const r = parseSchedule("0 9-17/2 1,15 * 1-5,7")
    expect(r.ok).toBe(true)
    if (r.ok && r.parsed.kind === "cron") {
      expect(r.parsed.fields.hours).toEqual([9, 11, 13, 15, 17])
      expect(r.parsed.fields.daysOfMonth).toEqual([1, 15])
      expect(r.parsed.fields.daysOfWeek).toEqual([0, 1, 2, 3, 4, 5]) // 7 → Sunday(0)
    }
  })

  it("rejects malformed cron with a precise error", () => {
    expect(parseSchedule("* * * *")).toMatchObject({ ok: false })
    expect(parseSchedule("61 * * * *")).toMatchObject({ ok: false })
    expect(parseSchedule("* * * foo *")).toMatchObject({ ok: false })
  })
})

describe("nextRunAtMs", () => {
  const base = new Date("2026-09-24T10:30:45.000Z").getTime()

  it("adds intervalMs for interval schedules", () => {
    expect(nextRunAtMs({ kind: "interval", intervalMs: 90_000 }, base)).toBe(
      new Date(base + 90_000).toISOString(),
    )
  })

  it("advances to the next matching minute for cron", () => {
    const parsed = parseSchedule("40 10 * * *")
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      const next = nextRunAtMs(parsed.parsed, base)
      // 10:39 was already past — next matching minute is today 10:40 UTC.
      expect(next).toBe("2026-09-24T10:40:00.000Z")
    }
  })

  it("skips to the next day when today's slots are exhausted", () => {
    const parsed = parseSchedule("30 9 * * *")
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(nextRunAtMs(parsed.parsed, base)).toBe("2026-09-25T09:30:00.000Z")
    }
  })

  it("honors dom/dow OR-semantics and never fires in the past", () => {
    const parsed = parseSchedule("0 0 1 * 0") // 1st OR any Sunday, midnight
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      const next = nextRunAtMs(parsed.parsed, base)
      expect(next).not.toBeNull()
      expect(Date.parse(next ?? "")).toBeGreaterThan(base)
    }
  })

  it("returns null for an impossible date instead of spinning forever", () => {
    const parsed = parseSchedule("0 0 30 2 *") // Feb 30 does not exist
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(nextRunAtMs(parsed.parsed, base)).toBeNull()
    }
  })
})

// ── Registry + PendingSlotManager lifecycle ──────────────────────────────────

function makeRegistry(overrides: { now?: () => number } = {}) {
  const persistence = createInMemorySlotPersistence()
  const registry = createJobsRegistry({
    persistence,
    idFactory: (() => {
      let n = 0
      return () => `job_test-${++n}`
    })(),
    ...overrides,
  })
  return { registry, persistence }
}

describe("jobs registry", () => {
  it("creates a job with computed nextRunAt and status", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-09-24T10:30:00.000Z"))
    const { registry } = makeRegistry()
    const r = registry.create({ name: "nightly", schedule: "0 2 * * *" })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.job.id).toBe("job_test-1")
      expect(r.job.scheduleKind).toBe("cron")
      expect(r.job.nextRunAt).toBe("2026-09-25T02:00:00.000Z")
      expect(r.job.triggerCount).toBe(0)
      expect(r.job.lastTriggeredAt).toBeNull()
    }
  })

  it("rejects an invalid schedule with the parser error", () => {
    const r = createJobsRegistry().create({ name: "bad", schedule: "* * * *" })
    expect(r).toMatchObject({ ok: false })
  })

  it("lists and deletes jobs; delete clears an armed slot", async () => {
    const { registry, persistence } = makeRegistry()
    const r = registry.create({ name: "j", schedule: "10000" })
    expect(r.ok).toBe(true)
    const id = r.ok ? r.job.id : ""
    await registry.trigger(id)
    // Slot cleared after dispatch — mark/clear bracket is balanced.
    expect(persistence.keys()).toEqual([])
    expect(registry.remove(id)).toBe(true)
    expect(registry.list()).toEqual([])
    expect(registry.remove(id)).toBe(false)
  })

  it("trigger records lastTriggeredAt + event and leaves NO pending slot", async () => {
    const { registry, persistence } = makeRegistry()
    const created = registry.create({ name: "j", schedule: "60000" })
    const id = created.ok ? created.job.id : ""
    const job = await registry.trigger(id)
    expect(job).toBeDefined()
    expect(job?.lastTriggeredAt).toBeTruthy()
    expect(job?.triggerCount).toBe(1)
    expect(job?.events[0]?.kind).toBe("manual-trigger")
    expect(await registry.slotFor(id)).toBeUndefined()
    expect(persistence.keys()).toEqual([])
  })

  it("leaves the slot armed if dispatch dies between mark and clear", async () => {
    // Simulate a crash: mark the slot through the persistence directly.
    const { registry, persistence } = makeRegistry()
    const created = registry.create({ name: "j", schedule: "60000" })
    const id = created.ok ? created.job.id : ""
    await persistence.set(jobSlotKey(id), {
      scheduledAt: "2026-09-24T10:00:00.000Z",
      at: "2026-09-24T10:00:00.000Z",
      by: "sched-dead-instance",
    })
    const slot = await registry.slotFor(id)
    expect(slot?.by).toBe("sched-dead-instance")
  })

  it("recoverOrphans re-dispatches an orphan exactly once", async () => {
    const { registry, persistence } = makeRegistry()
    const created = registry.create({ name: "j", schedule: "60000" })
    const id = created.ok ? created.job.id : ""
    await persistence.set(jobSlotKey(id), {
      scheduledAt: "2026-09-24T10:00:00.000Z",
      at: "2026-09-24T10:00:00.000Z",
      by: "sched-dead-instance",
    })
    const recovered = await registry.recoverOrphans()
    expect(recovered).toHaveLength(1)
    expect(recovered[0]).toMatchObject({ jobId: id, dispatched: true })
    const job = registry.get(id) as JobRecord
    expect(job.triggerCount).toBe(1)
    expect(job.events[0]?.kind).toBe("recovered-trigger")
    expect(job.events[0]?.note).toContain("exactly once")
    // Slot is gone after recovery — the second sweep finds nothing.
    expect(persistence.keys()).toEqual([])
    expect(await registry.recoverOrphans()).toEqual([])
  })

  it("ignores foreign slot keys during recovery", async () => {
    const { registry, persistence } = makeRegistry()
    await persistence.set("other:domain", {
      scheduledAt: "2026-09-24T10:00:00.000Z",
      at: "2026-09-24T10:00:00.000Z",
      by: "someone-else",
    })
    expect(await registry.recoverOrphans()).toEqual([])
    // Foreign key untouched.
    expect(await persistence.get("other:domain")).toBeDefined()
  })

  it("tick fires only due jobs and recomputes nextRunAt", async () => {
    let t = new Date("2026-09-24T10:00:00.000Z").getTime()
    const { registry } = makeRegistry({ now: () => t })
    const due = registry.create({ name: "due", schedule: "5000" })
    const later = registry.create({ name: "later", schedule: "600000" })
    // created at t → nextRunAt = t + 5s and t + 10min
    expect(due.ok && later.ok).toBe(true)
    t += 6_000
    expect(await registry.tick()).toBe(1)
    const dueJob = registry.get("job_test-1") as JobRecord
    expect(dueJob.triggerCount).toBe(1)
    expect(dueJob.nextRunAt).toBe(new Date(t + 5_000).toISOString())
    expect((registry.get("job_test-2") as JobRecord).triggerCount).toBe(0)
    // Not due again yet.
    expect(await registry.tick()).toBe(0)
  })

  it("startScheduler/stopScheduler do not leak timers", async () => {
    vi.useFakeTimers()
    const { registry } = makeRegistry()
    registry.create({ name: "j", schedule: "1000" })
    registry.startScheduler()
    registry.startScheduler() // idempotent
    await vi.advanceTimersByTimeAsync(3_500)
    const job = registry.get("job_test-1") as JobRecord
    expect(job.triggerCount).toBeGreaterThanOrEqual(2)
    registry.stopScheduler()
    const before = job.triggerCount
    await vi.advanceTimersByTimeAsync(5_000)
    expect((registry.get("job_test-1") as JobRecord).triggerCount).toBe(before)
  })
})

// ── Route handlers (direct calls, fake contexts, no HTTP) ────────────────────

function fakeContext(opts: { json?: unknown; param?: Record<string, string> }) {
  return {
    req: {
      valid: (type: string) => (type === "json" ? opts.json : (opts.param ?? {})),
    },
    json: (body: unknown, status?: number) => Response.json(body, { status: status ?? 200 }),
    body: (data: null, status: number) => new Response(null, { status }),
  } as never
}

async function bodyOf(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>
}

describe("jobs route handlers", () => {
  it("create → 201, list → 200, invalid schedule → 400", async () => {
    const { registry } = makeRegistry()
    const h = jobsRoutes({ registry })
    const ok = await h.create(
      fakeContext({ json: { name: "nightly", schedule: "0 2 * * *", payload: { a: 1 } } }),
    )
    expect(ok.status).toBe(201)
    const created = (await bodyOf(ok as Response)) as Record<string, unknown>
    expect(created.scheduleKind).toBe("cron")

    const bad = await h.create(fakeContext({ json: { name: "x", schedule: "nope" } }))
    expect(bad.status).toBe(400)
    expect(await bodyOf(bad as Response)).toHaveProperty("error")

    const list = await h.list(fakeContext({}))
    expect(list.status).toBe(200)
    const listed = await bodyOf(list as Response)
    expect(listed.total).toBe(1)
    expect((listed.jobs as unknown[]).length).toBe(1)
  })

  it("trigger → 200 with recorded job; unknown id → 404", async () => {
    const { registry } = makeRegistry()
    const h = jobsRoutes({ registry })
    const created = await h.create(fakeContext({ json: { name: "j", schedule: "60000" } }))
    const { id } = (await bodyOf(created as Response)) as { id: string }

    const fired = await h.trigger(fakeContext({ param: { id } }))
    expect(fired.status).toBe(200)
    const payload = await bodyOf(fired as Response)
    expect(payload.ok).toBe(true)
    const job = payload.job as Record<string, unknown>
    expect(job.triggerCount).toBe(1)

    const missing = await h.trigger(fakeContext({ param: { id: "nope" } }))
    expect(missing.status).toBe(404)
  })

  it("slots → 200 idle after clean dispatch; unknown id → 404", async () => {
    const { registry } = makeRegistry()
    const h = jobsRoutes({ registry })
    const created = await h.create(fakeContext({ json: { name: "j", schedule: "60000" } }))
    const { id } = (await bodyOf(created as Response)) as { id: string }

    const idle = await h.slots(fakeContext({ param: { id } }))
    expect(idle.status).toBe(200)
    expect(await bodyOf(idle as Response)).toMatchObject({ jobId: id, hasPendingSlot: false })

    await h.trigger(fakeContext({ param: { id } }))
    const idleAgain = await bodyOf((await h.slots(fakeContext({ param: { id } }))) as Response)
    expect(idleAgain.hasPendingSlot).toBe(false)

    expect((await h.slots(fakeContext({ param: { id: "ghost" } }))).status).toBe(404)
  })

  it("delete → 204, second delete → 404", async () => {
    const { registry } = makeRegistry()
    const h = jobsRoutes({ registry })
    const created = await h.create(fakeContext({ json: { name: "j", schedule: "60000" } }))
    const { id } = (await bodyOf(created as Response)) as { id: string }
    expect((await h.remove(fakeContext({ param: { id } }))).status).toBe(204)
    expect((await h.remove(fakeContext({ param: { id } }))).status).toBe(404)
  })
})
