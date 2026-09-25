/**
 * Unit tests for the Jobs dialog's pure model layer (jobs-model.ts):
 * relative-time bucketing, status-dot mapping, payload kind detection and
 * the detail event trail. All inputs are passthrough JSON — the tests pin
 * the defensive behavior for garbage too.
 */

import { describe, it, expect } from "vitest"
import type { Job } from "../src/api"
import {
  formatJobEvent,
  formatRelativeTime,
  formatSchedule,
  humanizeInterval,
  jobDetailEvents,
  jobStatusView,
  payloadKind,
  payloadLabelKey,
  relativeTime,
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
