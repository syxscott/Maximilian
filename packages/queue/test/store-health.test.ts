// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT

import { describe, expect, it, vi } from "vitest"
import {
  PROBE_INTERVAL_MS,
  StoreHealthRegistry,
  skippedRunCount,
  type DueRun,
  type StoreDegradedRecord,
} from "../src/store-health.js"
import { buildMissedOneShotDiagnostic, decideOneShotAfterOutage } from "../src/cron-outage.js"

function harness() {
  let now = 1_000_000
  let mono = 0
  const registry = new StoreHealthRegistry({ now: () => now, monotonic: () => mono })
  const advance = (ms: number) => {
    now += ms
    mono += ms
  }
  return { registry, advance, time: () => now }
}

describe("StoreHealthRegistry — degraded state machine", () => {
  it("the first failed write enters degraded and notifies once; later failures stay silent", () => {
    const { registry } = harness()
    const listener = vi.fn()
    registry.setTransitionListener(listener)
    expect(registry.noteUnwritable("s1", "ENOSPC: no space", "scan")).toBe(true)
    expect(registry.noteUnwritable("s1", "ENOSPC: no space", "claim")).toBe(false)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener.mock.calls[0]![0]).toBe("unwritable")
    const record = registry.degradedRecord("s1")!
    expect(record.sites).toEqual(new Set(["scan", "claim"]))
    expect(record.error).toBe("ENOSPC: no space")
  })

  it("a throwing listener never breaks the tick", () => {
    const { registry } = harness()
    registry.setTransitionListener(() => {
      throw new Error("notifier down")
    })
    expect(() => registry.noteUnwritable("s1", "EACCES", "scan")).not.toThrow()
    expect(registry.degradedRecord("s1")).not.toBeNull()
  })

  it("the first landing write clears degraded and archives the outage", () => {
    const { registry } = harness()
    const listener = vi.fn()
    registry.setTransitionListener(listener)
    registry.noteUnwritable("s1", "EROFS", "scan")
    const archived = registry.noteWritable("s1")!
    expect(registry.degradedRecord("s1")).toBeNull()
    expect(registry.recoveredRecord("s1")).toBe(archived)
    expect(archived.recoveredAt).toBeDefined()
    expect(listener).toHaveBeenCalledTimes(2)
    expect(listener.mock.calls[1]![0]).toBe("recovered")
  })

  it("a re-degrade after recovery carries the ORIGINAL outage start (since)", () => {
    const { registry, advance } = harness()
    registry.noteUnwritable("s1", "ENOSPC", "scan") // since = t0
    const since = registry.degradedRecord("s1")!.since
    advance(120_000)
    registry.noteWritable("s1")
    advance(5_000)
    registry.noteUnwritable("s1", "ENOSPC again", "scan")
    // The blip of recovery does not reset the outage clock.
    expect(registry.degradedRecord("s1")!.since).toBe(since)
  })

  it("skipped runs are a SET: each (job, instant) counted once per outage", () => {
    const { registry, advance } = harness()
    const run: DueRun = { id: "job-7", scheduledAtMs: 1_000_000 }
    registry.noteUnwritable("s1", "ENOSPC", "advance", [run])
    advance(1_000)
    registry.noteUnwritable("s1", "ENOSPC", "claim", [run]) // same run again
    registry.noteUnwritable("s1", "ENOSPC", "claim", [run]) // and again
    expect(skippedRunCount(registry.degradedRecord("s1")!)).toBe(1)
  })

  it("each outage counts its own misses (a new outage starts a fresh set)", () => {
    const { registry, advance } = harness()
    const run: DueRun = { id: "job-7", scheduledAtMs: 1_000_000 }
    registry.noteUnwritable("s1", "down", "advance", [run])
    registry.noteWritable("s1")
    registry.endRecoveryWindow("s1")
    advance(60_000)
    registry.noteUnwritable("s2", "down again", "advance", [run])
    expect(skippedRunCount(registry.degradedRecord("s2")!)).toBe(1)
  })
})

describe("StoreHealthRegistry — dispatch blocking and probe throttle", () => {
  it("a record entered by scan/load lets the FIRST dispatch attempt through", () => {
    const { registry } = harness()
    registry.noteUnwritable("s1", "ENOSPC", "scan")
    const probe = vi.fn(() => "still broken")
    expect(registry.dispatchBlocked("s1", [], probe)).toBe(false)
    expect(probe).not.toHaveBeenCalled() // dispatch's own write is the probe
  })

  it("after a failed dispatch write, re-probes throttle to one per minute", () => {
    const { registry, advance } = harness()
    registry.noteUnwritable("s1", "ENOSPC", "advance") // dispatch tried, failed
    const probe = vi.fn(() => "ENOSPC")
    const due: DueRun[] = [{ id: "j", scheduledAtMs: 1 }]
    expect(registry.dispatchBlocked("s1", due, probe)).toBe(true) // throttled window
    expect(probe).not.toHaveBeenCalled()
    advance(PROBE_INTERVAL_MS - 1)
    expect(registry.dispatchBlocked("s1", due, probe)).toBe(true)
    expect(probe).not.toHaveBeenCalled()
    advance(1)
    expect(registry.dispatchBlocked("s1", due, probe)).toBe(true) // probe ran, failed
    expect(probe).toHaveBeenCalledTimes(1)
    // And the probe failure re-arms the throttle.
    advance(PROBE_INTERVAL_MS - 1)
    expect(registry.dispatchBlocked("s1", due, probe)).toBe(true)
    expect(probe).toHaveBeenCalledTimes(1)
  })

  it("a passing probe unblocks dispatch (its save confirms recovery)", () => {
    const { registry, advance } = harness()
    registry.noteUnwritable("s1", "ENOSPC", "advance")
    advance(PROBE_INTERVAL_MS)
    expect(registry.dispatchBlocked("s1", [], () => undefined)).toBe(false)
    // Still degraded until the real save lands — but dispatch is allowed.
    expect(registry.degradedRecord("s1")).not.toBeNull()
  })

  it("blocked ticks record their skipped runs once", () => {
    const { registry, advance } = harness()
    registry.noteUnwritable("s1", "ENOSPC", "advance")
    const due: DueRun[] = [
      { id: "j1", scheduledAtMs: 5 },
      { id: "j2", scheduledAtMs: 6 },
    ]
    advance(1)
    registry.dispatchBlocked("s1", due)
    advance(1)
    registry.dispatchBlocked("s1", due) // same instant, throttled again
    const record: StoreDegradedRecord = registry.degradedRecord("s1")!
    expect(skippedRunCount(record)).toBe(2)
  })

  it("forgetStores drops state for departed stores", () => {
    const { registry } = harness()
    registry.noteUnwritable("keep", "x", "scan")
    registry.noteUnwritable("gone", "x", "scan")
    registry.noteWritable("gone")
    registry.forgetStores(["gone"])
    expect(registry.degradedRecord("keep")).not.toBeNull()
    expect(registry.recoveredRecord("gone")).toBeNull()
  })
})

describe("StoreHealthRegistry — outageCovers and the save-before-scan boundary", () => {
  it("covers a due inside a live outage (grace includes the boundary)", () => {
    const { registry } = harness()
    registry.noteUnwritable("s1", "down", "scan") // outage starts at t=1_000_000
    expect(registry.outageCovers("s1", 1_000_500, 1_000)).toBe(true)
    expect(registry.outageCovers("s1", 998_000, 1_000)).toBe(false) // before - grace
  })

  it("the just-ended outage still covers dues until the recovery window ends", () => {
    const { registry, advance } = harness()
    registry.noteUnwritable("s1", "down", "scan")
    advance(10_000)
    registry.noteWritable("s1") // recovered at 1_010_000
    // A one-shot due at 1_005_000 (inside the outage) is covered.
    expect(registry.outageCovers("s1", 1_005_000, 0)).toBe(true)
    // End the window (the due scan's save landed) and coverage stops.
    registry.endRecoveryWindow("s1")
    expect(registry.outageCovers("s1", 1_005_000, 0)).toBe(false)
  })

  it("grace covers a due slightly BEFORE the outage but saved after it", () => {
    const { registry } = harness()
    registry.noteUnwritable("s1", "down", "scan")
    // Due 500ms before the outage began; the 1s grace window spans the
    // save-before-scan boundary.
    expect(registry.outageCovers("s1", 999_500, 1_000)).toBe(true)
  })
})

describe("decideOneShotAfterOutage — exactly-once catch-up", () => {
  const due = 1_000_000
  const grace = 60_000

  it("fires inside the grace window", () => {
    const { registry } = harness()
    expect(
      decideOneShotAfterOutage({ dueAtMs: due, graceMs: grace, nowMs: due + grace }, registry, "s"),
    ).toEqual({
      action: "fire",
      reason: expect.stringContaining("grace"),
    })
  })

  it("fires ONCE for a due inside an outage, after recovery", () => {
    const { registry, advance } = harness()
    registry.noteUnwritable("s", "down", "scan") // outage starts at t=1_000_000
    advance(10_000)
    registry.noteWritable("s") // recovered at t=1_010_000; window still open
    // The one-shot was due at 1_005_000 — inside the outage — and the
    // catch-up decision happens much later.
    const decision = decideOneShotAfterOutage(
      { dueAtMs: 1_005_000, graceMs: 60_000, nowMs: 1_600_000 },
      registry,
      "s",
    )
    expect(decision.action).toBe("fire")
    expect(decision.reason).toContain("once")
  })

  it("an outage claim that never fired never started: still covered, fires", () => {
    const { registry } = harness()
    registry.endRecoveryWindow("s") // window closed: outage records alone insufficient
    const decision = decideOneShotAfterOutage(
      {
        dueAtMs: due + 10_000,
        graceMs: grace,
        nowMs: due + 600_000,
        claim: { outage: true },
        fireClaimPresent: false,
      },
      registry,
      "s",
    )
    expect(decision.action).toBe("fire")
  })

  it("an outage claim that DID reach its fire claim is in flight, not lost", () => {
    const { registry } = harness()
    const decision = decideOneShotAfterOutage(
      {
        dueAtMs: due + 10_000,
        graceMs: grace,
        nowMs: due + 600_000,
        claim: { outage: true },
        fireClaimPresent: true,
      },
      registry,
      "s",
    )
    expect(decision.action).toBe("skip-in-flight")
  })

  it("a plain claim beyond coverage skips (never double-fires)", () => {
    const { registry } = harness()
    const decision = decideOneShotAfterOutage(
      { dueAtMs: due + 10_000, graceMs: grace, nowMs: due + 600_000, claim: {} },
      registry,
      "s",
    )
    expect(decision.action).toBe("skip-in-flight")
  })

  it("beyond grace, no coverage, no claim: retire with a diagnostic", () => {
    const { registry } = harness()
    const input = { dueAtMs: due + 10_000, graceMs: grace, nowMs: due + 3_600_000 }
    const decision = decideOneShotAfterOutage(input, registry, "s")
    expect(decision.action).toBe("retire")
    const diagnostic = buildMissedOneShotDiagnostic("job-9", input, decision)
    expect(diagnostic).toEqual({
      jobId: "job-9",
      dueAtMs: due + 10_000,
      retiredAtMs: due + 3_600_000,
      reason: decision.reason,
    })
  })

  it("an outage window that ended long ago does not cover late dues", () => {
    const { registry, advance } = harness()
    registry.noteUnwritable("s", "down", "scan") // starts at 1_000_000
    advance(5_000)
    registry.noteWritable("s")
    registry.endRecoveryWindow("s")
    // Due AFTER the outage ended and the window closed: plain late, retire.
    const decision = decideOneShotAfterOutage(
      { dueAtMs: 1_100_000, graceMs: grace, nowMs: 3_000_000 },
      registry,
      "s",
    )
    expect(decision.action).toBe("retire")
  })
})
