/**
 * Unit tests for the Cron panel's pure model layer (cron-model.ts): the
 * 5-field cron validator, the cron-vs-interval list filter over GET
 * /api/jobs payloads, the create-form body builder, plus the POST
 * /api/jobs client wiring and an import smoke check for the component.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// The component smoke import needs ink mocked: its react-reconciler cannot
// boot under vitest's node environment (same approach as panels-smoke.test).
vi.mock("ink", () => ({
  Box: () => null,
  Text: () => null,
  useInput: () => undefined,
  useStdout: () => ({ write: () => {} }),
}))
vi.mock("ink-text-input", () => ({ default: () => null }))

import type { Job } from "../src/api"
import { createMaximilianClient } from "../src/api"
import {
  CRON_FIELDS,
  cronJobCreateInput,
  cronValidationError,
  filterCronJobs,
  isCronJob,
  isValidCron,
} from "../src/components/cron-model"

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

describe("isValidCron (5-field validation)", () => {
  it("accepts the standard expression shapes", () => {
    expect(isValidCron("0 9 * * *")).toBe(true)
    expect(isValidCron("*/5 * * * *")).toBe(true) // wildcard + step
    expect(isValidCron("0,30 9-17 * * 1-5")).toBe(true) // lists + ranges
    expect(isValidCron("0 9 */2 1,4,7,10 0")).toBe(true) // step on a range atom
    expect(isValidCron("  0 9 * * *  ")).toBe(true) // surrounding whitespace
  })

  it("rejects wrong field counts — including pure-digit intervalMs", () => {
    expect(isValidCron("")).toBe(false)
    expect(isValidCron("* * * *")).toBe(false)
    expect(isValidCron("* * * * * *")).toBe(false)
    expect(isValidCron("300000")).toBe(false) // an intervalMs, never cron
    expect(isValidCron("*")).toBe(false)
  })

  it("rejects numbers outside each field's range", () => {
    expect(isValidCron("60 * * * *")).toBe(false) // minute 0-59
    expect(isValidCron("* 24 * * *")).toBe(false) // hour 0-23
    expect(isValidCron("* * 0 * *")).toBe(false) // day-of-month 1-31
    expect(isValidCron("* * * 13 *")).toBe(false) // month 1-12
    expect(isValidCron("* * * * 8")).toBe(false) // day-of-week 0-7
    expect(isValidCron("0 9-24 * * *")).toBe(false) // range endpoint out of band
    expect(isValidCron("0 17-9 * * *")).toBe(false) // inverted range
    // Boundaries themselves hold (dow 0 and 7 are both Sunday).
    expect(isValidCron("59 23 31 12 7")).toBe(true)
    expect(isValidCron("0 0 1 1 0")).toBe(true)
  })

  it("rejects garbage atoms and non-string input", () => {
    expect(isValidCron(null)).toBe(false)
    expect(isValidCron(42)).toBe(false)
    expect(isValidCron("a b c d e")).toBe(false)
    expect(isValidCron("** * * * *")).toBe(false)
    expect(isValidCron("1-2-3 * * * *")).toBe(false)
    expect(isValidCron("*/0 * * * *")).toBe(false) // step must be ≥ 1
    expect(isValidCron("*/-5 * * * *")).toBe(false)
    expect(isValidCron("-1 * * * *")).toBe(false)
  })
})

describe("cronValidationError (first offending field, as label keys)", () => {
  it("is null for valid expressions and points at the broken field otherwise", () => {
    expect(cronValidationError("0 9 * * *")).toBeNull()
    expect(cronValidationError("0 25 * * *")).toEqual({
      fieldKey: "tui.cron.field.hour",
      index: 1,
    })
    expect(cronValidationError("* * * 13 *")).toEqual({
      fieldKey: "tui.cron.field.month",
      index: 3,
    })
    // First offense wins in a left-to-right scan.
    expect(cronValidationError("99 25 * * *")!.fieldKey).toBe("tui.cron.field.minute")
  })

  it("reports a wrong field count against the closest existing field", () => {
    expect(cronValidationError("* * *")!.index).toBe(2)
    // A single field (e.g. pasted intervalMs) points at the minute field.
    expect(cronValidationError("300000")).toEqual({
      fieldKey: "tui.cron.field.minute",
      index: 0,
    })
    // Empty / non-string input still degrades to a minute-field error.
    expect(cronValidationError("")).toEqual({ fieldKey: "tui.cron.field.minute", index: 0 })
    expect(cronValidationError(undefined)).toEqual({ fieldKey: "tui.cron.field.minute", index: 0 })
  })

  it("keeps the field rule table aligned with the validator", () => {
    expect(CRON_FIELDS.map((f) => f.name)).toEqual([
      "minute",
      "hour",
      "dayOfMonth",
      "month",
      "dayOfWeek",
    ])
  })
})

describe("isCronJob / filterCronJobs (list filter)", () => {
  it("keeps valid cron schedules and excludes pure-digit intervals", () => {
    expect(isCronJob(makeJob())).toBe(true)
    expect(
      isCronJob(makeJob({ schedule: "300000", scheduleKind: "interval", intervalMs: 300_000 })),
    ).toBe(false)
    expect(isCronJob(makeJob({ schedule: "nonsense literal" }))).toBe(false)
    expect(isCronJob(null)).toBe(false)
    expect(isCronJob({ schedule: 42 })).toBe(false)
    expect(isCronJob({ schedule: "0 9 * * *" })).toBe(true) // scheduleKind not consulted
  })

  it("filters the list preserving API order and survives garbage payloads", () => {
    const jobs = [
      makeJob({ id: "interval" as string, schedule: "60000", scheduleKind: "interval" }),
      makeJob({ id: "cron-first", name: "morning", schedule: "0 8 * * *" }),
      makeJob({ id: "cron-second", name: "weekly", schedule: "0 9 * * 1" }),
      makeJob({ id: "broken", schedule: "not a cron" }),
      "junk",
    ]
    expect(filterCronJobs(jobs).map((j) => j.id)).toEqual(["cron-first", "cron-second"])
    expect(filterCronJobs(undefined)).toEqual([])
  })
})

describe("cronJobCreateInput (POST body builder)", () => {
  it("trims fields and builds a real workspace dispatch payload", () => {
    expect(cronJobCreateInput(" digest ", " 0 9 * * * ", " summarize the week ")).toEqual({
      name: "digest",
      schedule: "0 9 * * *",
      payload: { kind: "workspace", message: "summarize the week" },
    })
  })
})

// ── Client wiring (POST /api/jobs) + component smoke ────────────────────────

function makeResponse(body: unknown, init?: { ok?: boolean; status?: number }): Response {
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 201,
    statusText: "OK",
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  } as Response
}

describe("cron panel client + module wiring", () => {
  let originalFetch: typeof fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it("creates a job via POST /api/jobs with the JSON body and returns it", async () => {
    const created = makeJob({ id: "job_new", name: "digest" })
    const fetchMock = vi.fn(async () => Promise.resolve(makeResponse(created)))
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const client = createMaximilianClient("http://localhost:3001", "tok")
    const result = await client.createJob(cronJobCreateInput("digest", "0 9 * * *", "go"))

    const call = fetchMock.mock.calls[0]!
    expect(call[0]).toBe("http://localhost:3001/api/jobs")
    expect((call[1] as RequestInit).method).toBe("POST")
    expect(JSON.parse((call[1] as RequestInit).body as string)).toEqual({
      name: "digest",
      schedule: "0 9 * * *",
      payload: { kind: "workspace", message: "go" },
    })
    expect(((call[1] as RequestInit).headers as Record<string, string>)["authorization"]).toBe(
      "Bearer tok",
    )
    expect(result.id).toBe("job_new")
  })

  it("surfaces create failures as an Error (400 invalid schedule)", async () => {
    const fetchMock = vi.fn(async () =>
      Promise.resolve(makeResponse("Invalid body or schedule", { ok: false, status: 400 })),
    )
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const client = createMaximilianClient("http://localhost:3001")
    await expect(client.createJob(cronJobCreateInput("x", "nope", "go"))).rejects.toThrow(
      /400.*Invalid body or schedule/,
    )
  })

  it("imports the CronPanel component and merges its locale strings", async () => {
    vi.resetModules()
    const { CronPanel } = await import("../src/components/cron-panel")
    expect(typeof CronPanel).toBe("function")
    // The panel module merges the tui-panels subtree over the core
    // dictionaries at import time — both languages, both domains.
    const { getDictionary } = await import("@max/i18n")
    for (const locale of ["zh-CN", "en-US"]) {
      const dict = getDictionary(locale) as Record<string, string> | undefined
      expect(dict?.["tui.cron"]).toBeTruthy()
      expect(dict?.["tui.cron.create.schedule"]).toBeTruthy()
      expect(dict?.["tui.agents"]).toBeTruthy()
      expect(dict?.["tui.agents.bucket.commonErrors"]).toBeTruthy()
    }
  })
})
