// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT

import { describe, expect, it, vi } from "vitest"
import {
  CronIncidentLedger,
  DEFAULT_MAX_TRANSIENT_RETRIES,
  adjudicateCycle,
  finalizeCronFailureNotifications,
  holdsFailureNotificationForRetry,
  type CronNotificationSink,
  type CronRunResult,
} from "../src/cron-notifications.js"

const providerError: CronRunResult = { status: "error", failureKind: "provider" }
const scriptError: CronRunResult = { status: "error", failureKind: "script" }
const watchdogError: CronRunResult = { status: "error", failureKind: "watchdog-timeout" }
const commandTimeout: CronRunResult = { status: "error", failureKind: "command-timeout" }

function trackingSink(): CronNotificationSink & {
  alerts: number
  repairs: number
  clears: number
} {
  const sink = {
    alerts: 0,
    repairs: 0,
    clears: 0,
    failureAlert: () => {
      sink.alerts += 1
    },
    ownerRepair: () => {
      sink.repairs += 1
    },
    incidentCleared: () => {
      sink.clears += 1
    },
  }
  return sink
}

describe("holdsFailureNotificationForRetry — the hold bounds", () => {
  it("holds a provider failure while the retry budget lasts and a next run exists", () => {
    expect(
      holdsFailureNotificationForRetry({
        result: providerError,
        retriesUsed: 0,
        nextRunAtMs: 10_000,
      }),
    ).toBe(true)
  })

  it("never holds past the transient retry budget", () => {
    expect(
      holdsFailureNotificationForRetry({
        result: providerError,
        retriesUsed: DEFAULT_MAX_TRANSIENT_RETRIES,
        nextRunAtMs: 10_000,
      }),
    ).toBe(false)
  })

  it("never holds without a next run (disabled job / retired one-shot / dead schedule)", () => {
    expect(holdsFailureNotificationForRetry({ result: providerError, retriesUsed: 0 })).toBe(false)
  })

  it("never holds job-owned failures: watchdog, script, command timeout, unknown", () => {
    for (const result of [watchdogError, scriptError, commandTimeout]) {
      expect(
        holdsFailureNotificationForRetry({
          result,
          retriesUsed: 0,
          nextRunAtMs: 10_000,
        }),
      ).toBe(false)
    }
  })

  it("only error results can hold", () => {
    expect(
      holdsFailureNotificationForRetry({
        result: { status: "succeeded" },
        retriesUsed: 0,
        nextRunAtMs: 10_000,
      }),
    ).toBe(false)
    expect(
      holdsFailureNotificationForRetry({
        result: { status: "cancelled" },
        retriesUsed: 0,
        nextRunAtMs: 10_000,
      }),
    ).toBe(false)
  })

  it("adjudicateCycle returns the pure decision", () => {
    expect(adjudicateCycle({ result: providerError, retriesUsed: 1, nextRunAtMs: 5_000 })).toEqual({
      pendingTransientRetry: true,
    })
    expect(adjudicateCycle({ result: scriptError, retriesUsed: 1, nextRunAtMs: 5_000 })).toEqual({
      pendingTransientRetry: false,
    })
  })
})

describe("finalizeCronFailureNotifications — the pendingTransientRetry hold", () => {
  it("skips alert AND owner repair while a transient retry is pending", () => {
    const sink = trackingSink()
    finalizeCronFailureNotifications(
      {
        jobId: "hourly",
        result: providerError,
        adjudication: { pendingTransientRetry: true },
        consecutiveErrors: 3,
        owned: true,
      },
      sink,
    )
    finalizeCronFailureNotifications(
      {
        jobId: "hourly-unowned",
        result: providerError,
        adjudication: { pendingTransientRetry: true },
        consecutiveErrors: 3,
        owned: false,
      },
      sink,
    )
    expect(sink.alerts).toBe(0)
    expect(sink.repairs).toBe(0)
  })

  it("after the budget is spent, the normal notification fires with the full count", () => {
    const sink = trackingSink()
    finalizeCronFailureNotifications(
      {
        jobId: "hourly",
        result: providerError,
        adjudication: { pendingTransientRetry: false },
        consecutiveErrors: 4,
        owned: true,
      },
      sink,
    )
    expect(sink.repairs).toBe(1)
  })

  it("job-owned failures notify immediately even within the budget", () => {
    const sink = trackingSink()
    finalizeCronFailureNotifications(
      {
        jobId: "scripty",
        result: scriptError,
        adjudication: { pendingTransientRetry: false },
        consecutiveErrors: 2,
        owned: true,
      },
      sink,
    )
    expect(sink.repairs).toBe(1)
  })

  it("respects alertAfter and the auto-disable ownership guard", () => {
    const sink = trackingSink()
    finalizeCronFailureNotifications(
      {
        jobId: "young",
        result: providerError,
        adjudication: { pendingTransientRetry: false },
        consecutiveErrors: 1,
        owned: true,
      },
      sink,
    )
    expect(sink.repairs).toBe(0) // below alertAfter (2)
    finalizeCronFailureNotifications(
      {
        jobId: "auto-disabled",
        result: providerError,
        adjudication: { pendingTransientRetry: false },
        consecutiveErrors: 5,
        owned: true,
        autoDisableNotificationOwnsFailure: true,
      },
      sink,
    )
    expect(sink.repairs).toBe(0)
  })

  it("a throwing sink must not throw out of finalize", () => {
    expect(() =>
      finalizeCronFailureNotifications(
        {
          jobId: "loud",
          result: providerError,
          adjudication: { pendingTransientRetry: false },
          consecutiveErrors: 3,
          owned: false,
        },
        {
          failureAlert: () => {
            throw new Error("channel down")
          },
        },
      ),
    ).not.toThrow()
  })
})

describe("invariant: a cancelled completion envelope NEVER triggers a failure alert", () => {
  it("cancel envelope alone: no alert, no repair, at any consecutive-error depth", () => {
    const sink = trackingSink()
    for (const consecutiveErrors of [0, 1, 2, 5, 50]) {
      finalizeCronFailureNotifications(
        {
          jobId: "j",
          result: { status: "cancelled", failureKind: "unknown" },
          adjudication: { pendingTransientRetry: false },
          consecutiveErrors,
          owned: true,
        },
        sink,
      )
    }
    expect(sink.alerts).toBe(0)
    expect(sink.repairs).toBe(0)
  })

  it("the terminal one-shot failure alert and the cancel envelope are INDEPENDENT paths", () => {
    // Assertion 1 (failure path): consecutive failures past the threshold
    // fire exactly one alert for the one-shot.
    const failureSink = trackingSink()
    const ledger = new CronIncidentLedger()
    let consecutive = 0
    for (let i = 0; i < 3; i += 1) consecutive = ledger.recordFailure("oneshot")
    finalizeCronFailureNotifications(
      {
        jobId: "oneshot",
        result: providerError,
        adjudication: { pendingTransientRetry: false },
        consecutiveErrors: consecutive,
        owned: false,
        alertAfter: 2,
      },
      failureSink,
    )
    expect(failureSink.alerts).toBe(1)

    // Assertion 2 (cancel path): a cancellation envelope on the SAME job
    // state fires nothing, even with the alert armed.
    const cancelSink = trackingSink()
    finalizeCronFailureNotifications(
      {
        jobId: "oneshot",
        result: { status: "cancelled" },
        adjudication: { pendingTransientRetry: false },
        consecutiveErrors: consecutive,
        owned: false,
        alertAfter: 2,
      },
      cancelSink,
    )
    expect(cancelSink.alerts).toBe(0)
  })

  it("cancellation is bookkeeping-neutral in the incident ledger", () => {
    const ledger = new CronIncidentLedger()
    ledger.recordFailure("j")
    ledger.recordFailure("j")
    ledger.recordCancelled("j")
    expect(ledger.consecutiveErrors("j")).toBe(2) // cancel does not extend...
    const sink = trackingSink()
    ledger.recordSuccess("j", sink)
    expect(ledger.consecutiveErrors("j")).toBe(0) // ...nor block the clear
    expect(sink.clears).toBe(1)
  })
})

describe("CronIncidentLedger — bookkeeping runs while notifications are held", () => {
  it("a success during the hold clears the incident silently", () => {
    const ledger = new CronIncidentLedger()
    const sink = trackingSink()
    // Failure 1: below threshold, no notification even without a hold.
    let consecutive = ledger.recordFailure("j")
    finalizeCronFailureNotifications(
      {
        jobId: "j",
        result: providerError,
        adjudication: { pendingTransientRetry: true },
        consecutiveErrors: consecutive,
        owned: false,
      },
      sink,
    )
    expect(sink.alerts).toBe(0)
    // Failure 2: still held (retry pending), but the incident KEEPS COUNTING.
    consecutive = ledger.recordFailure("j")
    expect(consecutive).toBe(2)
    finalizeCronFailureNotifications(
      {
        jobId: "j",
        result: providerError,
        adjudication: { pendingTransientRetry: true },
        consecutiveErrors: consecutive,
        owned: false,
      },
      sink,
    )
    expect(sink.alerts).toBe(0)
    // The outage ended; the quick retry SUCCEEDS: silent clear, no alert.
    ledger.recordSuccess("j", sink)
    expect(sink.clears).toBe(1)
    expect(sink.alerts).toBe(0)
    expect(ledger.consecutiveErrors("j")).toBe(0)
  })

  it("a failure AFTER the hold window used up sends the normal alert once", () => {
    const ledger = new CronIncidentLedger()
    const sink = trackingSink()
    let consecutive = 0
    for (let i = 0; i < DEFAULT_MAX_TRANSIENT_RETRIES + 1; i += 1) {
      consecutive = ledger.recordFailure("j")
      finalizeCronFailureNotifications(
        {
          jobId: "j",
          result: providerError,
          // Retries i..budget hold; past the budget the alert lands.
          adjudication: adjudicateCycle({
            result: providerError,
            retriesUsed: i,
            nextRunAtMs: i < DEFAULT_MAX_TRANSIENT_RETRIES ? 1_000 : undefined,
          }),
          consecutiveErrors: consecutive,
          owned: false,
        },
        sink,
      )
    }
    expect(sink.alerts).toBe(1)
  })
})
