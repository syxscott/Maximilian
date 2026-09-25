/**
 * Unit tests for the Jobs dialog's pure model layer (jobs-model.ts):
 * relative-time bucketing, status-dot mapping, payload kind detection and
 * the detail event trail. All inputs are passthrough JSON — the tests pin
 * the defensive behavior for garbage too.
 */

import { describe, it, expect } from "vitest"
import type { Job } from "../src/api"
import {
  elapsedSeconds,
  formatJobEvent,
  formatRelativeTime,
  formatSchedule,
  humanizeInterval,
  jobDetailEvents,
  jobEventKindLabel,
  jobStatusView,
  materializationEventTarget,
  materializedWorkspaceIdOf,
  payloadKind,
  payloadLabelKey,
  pendingRefreshDelays,
  relativeTime,
  scheduleEstimate,
  workspaceChipLabel,
} from "../src/components/jobs-model"

const NOW = Date.parse("2026-09-25T12:00:00.000Z")

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: "job_1",
    name: "nightly-digest",
    schedule: "0 9 * * *",
    scheduleKind: "cron",
    intervalMs: null,
    description: null,
    payload: undefined,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    lastTriggeredAt: null,
    nextRunAt: "2026-09-26T09:00:00.000Z",
    triggerCount: 0,
    events: [],
    ...overrides,
  }
}

describe("relativeTime", () => {
  it("returns null for null/empty/unparseable input (the 'never' case)", () => {
    expect(relativeTime(null, NOW)).toBeNull()
    expect(relativeTime(undefined, NOW)).toBeNull()
    expect(relativeTime("", NOW)).toBeNull()
    expect(relativeTime("not-a-date", NOW)).toBeNull()
  })

  it("buckets sub-minute deltas as 'now'", () => {
    expect(relativeTime("2026-09-25T11:59:30.000Z", NOW)).toEqual({ key: "now" })
    expect(relativeTime("2026-09-25T12:00:00.000Z", NOW)).toEqual({ key: "now" })
  })

  it("buckets minutes / hours / days with the right unit", () => {
    expect(relativeTime("2026-09-25T11:55:00.000Z", NOW)).toEqual({
      key: "ago",
      value: 5,
      unit: "m",
    })
    expect(relativeTime("2026-09-25T09:00:00.000Z", NOW)).toEqual({
      key: "ago",
      value: 3,
      unit: "h",
    })
    expect(relativeTime("2026-09-23T12:00:00.000Z", NOW)).toEqual({
      key: "ago",
      value: 2,
      unit: "d",
    })
  })

  it("falls back to an absolute date beyond 30 days", () => {
    expect(relativeTime("2026-01-05T08:00:00.000Z", NOW)).toEqual({
      key: "date",
      date: "2026-01-05",
    })
  })

  it("formatRelativeTime renders the compact English fallback", () => {
    expect(formatRelativeTime(null, "never")).toBe("never")
    expect(formatRelativeTime({ key: "now" })).toBe("just now")
    expect(formatRelativeTime({ key: "ago", value: 5, unit: "m" })).toBe("5m ago")
    expect(formatRelativeTime({ key: "date", date: "2026-01-05" })).toBe("2026-01-05")
  })
})

describe("jobStatusView (status dot mapping)", () => {
  it("is red/stalled when the latest event is dispatch-failed", () => {
    const job = makeJob({
      events: [
        { at: "2026-09-25T10:00:00.000Z", kind: "manual-trigger" },
        { at: "2026-09-25T10:01:00.000Z", kind: "dispatch-failed", error: "boom" },
      ],
    })
    expect(jobStatusView(job)).toEqual({ color: "red", statusKey: "stalled" })
  })

  it("is gray/idle when there is no schedulable next run", () => {
    expect(jobStatusView(makeJob({ nextRunAt: null }))).toEqual({
      color: "gray",
      statusKey: "idle",
    })
  })

  it("is green/armed when a next run exists and no dispatch failed", () => {
    expect(jobStatusView(makeJob())).toEqual({ color: "green", statusKey: "armed" })
  })

  it("survives a garbage events array", () => {
    expect(jobStatusView(makeJob({ events: undefined as unknown as Job["events"] }))).toEqual({
      color: "green",
      statusKey: "armed",
    })
  })
})

describe("payloadKind + label keys", () => {
  it("detects a fully-valid workspace dispatch payload", () => {
    expect(payloadKind({ kind: "workspace", message: "run the digest" })).toBe("workspace")
    expect(payloadLabelKey("workspace")).toBe("tui.jobs.payload.workspace")
  })

  it("treats kind none / absent / legacy objects / garbage honestly", () => {
    expect(payloadKind({ kind: "none" })).toBe("none")
    expect(payloadKind(undefined)).toBe("none")
    expect(payloadKind(null)).toBe("none")
    expect(payloadKind({ foo: 1 })).toBe("legacy")
    expect(payloadKind({ kind: "workspace" })).toBe("unknown") // message required
    expect(payloadKind({ kind: "nonsense" })).toBe("unknown")
    expect(payloadKind("nope")).toBe("none") // non-object = record-only
  })
})

describe("schedule + detail helpers", () => {
  it("humanizes interval schedules and passes cron expressions through", () => {
    expect(humanizeInterval(30_000)).toBe("every 30s")
    expect(humanizeInterval(300_000)).toBe("every 5m")
    expect(humanizeInterval(7_200_000)).toBe("every 2h")
    expect(humanizeInterval(86_400_000)).toBe("every 1d")
    expect(humanizeInterval(undefined)).toBe("every ?")
    expect(formatSchedule(makeJob({ schedule: "*/5 * * * *", scheduleKind: "cron" }))).toBe(
      "*/5 * * * *",
    )
    expect(
      formatSchedule(
        makeJob({ schedule: "300000", scheduleKind: "interval", intervalMs: 300_000 }),
      ),
    ).toBe("every 5m")
  })

  it("returns the newest events first, capped at the limit", () => {
    const job = makeJob({
      events: [
        { at: "2026-09-25T10:00:00.000Z", kind: "scheduled-trigger" },
        { at: "2026-09-25T11:00:00.000Z", kind: "dispatched", queued: true },
        { at: "2026-09-25T12:00:00.000Z", kind: "materialized", workspaceId: "ws-9" },
      ],
    })
    const events = jobDetailEvents(job, 2)
    expect(events.map((e) => e.kind)).toEqual(["materialized", "dispatched"])
  })

  it("formats an event trail line defensively", () => {
    expect(formatJobEvent({ at: "2026-09-25T10:01:02.000Z", kind: "manual-trigger" })).toBe(
      "10:01:02 manual-trigger",
    )
    expect(
      formatJobEvent({
        at: "2026-09-25T10:01:02.000Z",
        kind: "dispatched",
        note: "queued:42 on workspace",
      }),
    ).toBe("10:01:02 dispatched — queued:42 on workspace")
    expect(formatJobEvent({} as Job["events"][number])).toBe("??:??:?? unknown")
    expect(jobDetailEvents(makeJob({ events: [] }))).toEqual([])
  })
})

describe("jobEventKindLabel (trigger-history kind routing)", () => {
  it("routes every kind the API writes to its event key", () => {
    for (const kind of [
      "scheduled-trigger",
      "manual-trigger",
      "dispatched",
      "dispatch-failed",
      "materialized",
    ]) {
      expect(jobEventKindLabel(kind)).toEqual({ key: `tui.jobs.event.${kind}`, known: true })
    }
  })

  it("marks unknown/garbage kinds so the dialog prints the raw kind (never a bare key)", () => {
    expect(jobEventKindLabel("future-kind")).toEqual({
      key: "tui.jobs.event.future-kind",
      known: false,
    })
    expect(jobEventKindLabel(undefined)).toEqual({ key: "tui.jobs.event.unknown", known: false })
    expect(jobEventKindLabel(null).known).toBe(false)
    expect(jobEventKindLabel(42).known).toBe(false)
    expect(jobEventKindLabel("").known).toBe(false)
    expect(jobEventKindLabel("   ").known).toBe(false)
  })
})

describe("formatJobEvent deepening (relative time + localized kind)", () => {
  it("appends a relative marker when nowMs is given", () => {
    const event = { at: "2026-09-25T11:55:00.000Z", kind: "scheduled-trigger" }
    expect(formatJobEvent(event, NOW)).toBe("11:55:00 scheduled-trigger (5m ago)")
    expect(formatJobEvent(event, Date.parse("2026-09-25T11:55:10.000Z"))).toBe(
      "11:55:00 scheduled-trigger (just now)",
    )
  })

  it("replaces the kind with the localized label when kindLabel is given", () => {
    expect(
      formatJobEvent(
        { at: "2026-09-25T11:55:00.000Z", kind: "scheduled-trigger", note: "cron 0 9" },
        NOW,
        "计划触发",
      ),
    ).toBe("11:55:00 计划触发 — cron 0 9 (5m ago)")
  })

  it("drops the relative marker for unparseable timestamps instead of lying", () => {
    // Short garbage slices to an empty clock ("junk".slice(11, 19) === "").
    expect(formatJobEvent({ at: "junk", kind: "dispatched" }, NOW)).toBe(" dispatched")
    // Long-enough garbage keeps its raw slice but never gains "(never)".
    expect(formatJobEvent({ at: "2026-13-99T99:99:99Z", kind: "dispatched" }, NOW)).toBe(
      "99:99:99 dispatched",
    )
    expect(formatJobEvent({ at: "2026-09-25T11:55:00.000Z", kind: "x" }, Number.NaN)).toBe(
      "11:55:00 x",
    )
  })
})

describe("scheduleEstimate (honest next-fire estimate)", () => {
  it("reads pure-digit schedules as intervalMs rounded to whole seconds", () => {
    expect(
      scheduleEstimate(makeJob({ schedule: "300000", scheduleKind: "interval", intervalMs: null })),
    ).toEqual({ kind: "interval", intervalMs: 300_000, label: "every 5m" })
    // 29.5s rounds up to a whole 30s — never a fractional second.
    expect(
      scheduleEstimate(makeJob({ schedule: "29500", scheduleKind: "interval", intervalMs: null })),
    ).toEqual({ kind: "interval", intervalMs: 30_000, label: "every 30s" })
  })

  it("labels 5-field cron expressions honestly: the expression passes through, no time is computed", () => {
    expect(scheduleEstimate(makeJob())).toEqual({ kind: "cron", label: "0 9 * * *" })
    expect(scheduleEstimate(makeJob({ schedule: "*/5 * * * *" }))).toEqual({
      kind: "cron",
      label: "*/5 * * * *",
    })
  })

  it("falls back to a positive intervalMs field when the schedule string is unparseable", () => {
    expect(scheduleEstimate(makeJob({ schedule: "every morning", intervalMs: 60_000 }))).toEqual({
      kind: "interval",
      intervalMs: 60_000,
      label: "every 1m",
    })
  })

  it("yields unknown ('?') when nothing is derivable — never invents a time", () => {
    expect(scheduleEstimate(makeJob({ schedule: "nonsense literal", intervalMs: null }))).toEqual({
      kind: "unknown",
      label: "?",
    })
    expect(scheduleEstimate(makeJob({ schedule: "0 9 * * * extra", intervalMs: null }))).toEqual({
      kind: "unknown",
      label: "?",
    })
    expect(scheduleEstimate(makeJob({ schedule: "", intervalMs: null }))).toEqual({
      kind: "unknown",
      label: "?",
    })
    expect(scheduleEstimate(makeJob({ schedule: "-500", intervalMs: null }))).toEqual({
      kind: "unknown",
      label: "?",
    })
  })
})

describe("elapsedSeconds (refresh hint)", () => {
  it("returns whole seconds clamped at zero against clock skew", () => {
    expect(elapsedSeconds(1_000, 61_000)).toBe(60)
    expect(elapsedSeconds(61_000, 1_000)).toBe(0)
    expect(elapsedSeconds(1_000, 1_000)).toBe(0)
  })

  it("yields null on garbage so the dialog can hide the hint", () => {
    expect(elapsedSeconds(undefined, 1_000)).toBeNull()
    expect(elapsedSeconds(1_000, "junk" as unknown as number)).toBeNull()
    expect(elapsedSeconds(Number.NaN, 1_000)).toBeNull()
    expect(elapsedSeconds(1_000, Number.POSITIVE_INFINITY)).toBeNull()
  })
})

// ── Materialization chain ────────────────────────────────────────────────────

describe("materializedWorkspaceIdOf", () => {
  it("prefers a non-empty top-level materializedWorkspaceId when a future API promotes the field onto the row", () => {
    const job = makeJob({
      materializedWorkspaceId: "ws-row-level",
      events: [{ at: "2026-09-25T10:00:00.000Z", kind: "materialized", workspaceId: "ws-trail" }],
    })
    expect(materializedWorkspaceIdOf(job)).toBe("ws-row-level")
  })

  it("falls back to the newest trail entry carrying a workspaceId (newest-first scan)", () => {
    const job = makeJob({
      events: [
        { at: "2026-09-24T10:00:00.000Z", kind: "materialized", workspaceId: "ws-old" },
        { at: "2026-09-25T10:00:00.000Z", kind: "dispatched", queued: true },
        { at: "2026-09-25T11:00:00.000Z", kind: "materialized", workspaceId: "ws-new" },
      ],
    })
    expect(materializedWorkspaceIdOf(job)).toBe("ws-new")
  })

  it("yields null for a FAILED materialization (trail entry without a workspaceId) — no chip for a failure", () => {
    const job = makeJob({
      events: [
        { at: "2026-09-25T10:00:00.000Z", kind: "dispatched", queued: true },
        {
          at: "2026-09-25T10:01:00.000Z",
          kind: "materialized",
          error: "generation rejected",
        },
      ],
    })
    expect(materializedWorkspaceIdOf(job)).toBeNull()
  })

  it("is defensive: garbage rows, garbage events and empty/whitespace ids degrade to null", () => {
    expect(materializedWorkspaceIdOf(null)).toBeNull()
    expect(materializedWorkspaceIdOf(undefined)).toBeNull()
    expect(materializedWorkspaceIdOf("junk" as unknown as Job)).toBeNull()
    expect(
      materializedWorkspaceIdOf(
        makeJob({ events: [{ at: "2026-09-25T10:00:00.000Z", kind: "materialized" }] }),
      ),
    ).toBeNull()
    expect(
      materializedWorkspaceIdOf(
        makeJob({
          events: [
            null,
            "garbage",
            { at: "2026-09-25T10:00:00.000Z", kind: "materialized", workspaceId: "   " },
            { at: "2026-09-25T10:01:00.000Z", kind: "materialized", workspaceId: 42 },
            { at: "2026-09-25T10:02:00.000Z", kind: "materialized", workspaceId: "ws-real" },
          ] as unknown as Job["events"],
        }),
      ),
    ).toBe("ws-real")
  })

  it("falls through an explicit null top-level field to the trail (the field is `string | null` optional)", () => {
    const job = makeJob({
      materializedWorkspaceId: null,
      events: [{ at: "2026-09-25T10:00:00.000Z", kind: "materialized", workspaceId: "ws-trail" }],
    })
    expect(materializedWorkspaceIdOf(job)).toBe("ws-trail")
    // A whitespace-only top-level value is not an id either.
    expect(
      materializedWorkspaceIdOf(makeJob({ materializedWorkspaceId: "  ", events: [] })),
    ).toBeNull()
  })
})

describe("pendingRefreshDelays (post-trigger materialization catches)", () => {
  it("pins the +2s/+5s cadence", () => {
    expect(pendingRefreshDelays()).toEqual([2000, 5000])
  })

  it("returns a fresh array per call so callers cannot mutate shared state", () => {
    const first = pendingRefreshDelays()
    const second = pendingRefreshDelays()
    expect(first).not.toBe(second)
    first[0] = 99
    expect(pendingRefreshDelays()[0]).toBe(2000)
  })
})

describe("materializationEventTarget (job-materialized SSE parse)", () => {
  it("parses a materialized announcement into its jobId→workspaceId pair", () => {
    expect(
      materializationEventTarget({
        type: "job-materialized",
        jobId: "job_1",
        workspaceId: "ws-real-9",
        scheduledWorkspaceId: "ws-scheduled",
        outcome: "materialized",
        at: "2026-09-25T12:00:00.000Z",
      }),
    ).toEqual({ jobId: "job_1", workspaceId: "ws-real-9" })
    // Extra/unknown fields are ignored, not rejected.
    expect(materializationEventTarget({ jobId: "job_2", workspaceId: "ws-1", junk: true })).toEqual(
      { jobId: "job_2", workspaceId: "ws-1" },
    )
  })

  it("keeps a failed announcement with workspaceId null (the inline hint degrades honestly)", () => {
    expect(materializationEventTarget({ jobId: "job_1", outcome: "failed" })).toEqual({
      jobId: "job_1",
      workspaceId: null,
    })
    expect(materializationEventTarget({ jobId: "job_1", workspaceId: "   " })).toEqual({
      jobId: "job_1",
      workspaceId: null,
    })
  })

  it("returns null for anything without a usable jobId — garbage never becomes a hint", () => {
    expect(materializationEventTarget(null)).toBeNull()
    expect(materializationEventTarget("job-materialized")).toBeNull()
    expect(materializationEventTarget({ workspaceId: "ws-1" })).toBeNull()
    expect(materializationEventTarget({ jobId: "" })).toBeNull()
    expect(materializationEventTarget({ jobId: "   " })).toBeNull()
    expect(materializationEventTarget({ jobId: 42, workspaceId: "ws-1" })).toBeNull()
  })
})

describe("workspaceChipLabel (row chip)", () => {
  it("passes short ids through and truncates long ones for an 80-column terminal", () => {
    expect(workspaceChipLabel("ws-abc123")).toBe("ws-abc123")
    const long = "ws-" + "a".repeat(40)
    expect(workspaceChipLabel(long)).toBe(`${"ws-" + "a".repeat(18)}…`)
    expect(workspaceChipLabel(long)).toHaveLength(22)
    expect(workspaceChipLabel("  ws-padded  ")).toBe("ws-padded")
  })

  it("degrades garbage to '?' instead of rendering 'undefined'", () => {
    expect(workspaceChipLabel(undefined)).toBe("?")
    expect(workspaceChipLabel(42 as unknown as string)).toBe("?")
    expect(workspaceChipLabel("   ")).toBe("?")
  })
})
