// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Tests for the ZCode borrowings batch: CrashBudget (sliding-window crash
 * backoff), CapabilityTicket (one-time TTL elevation), RemoteCatalogSynchronizer
 * (lease + https-only + budget + failure backoff).
 */
import { describe, it, expect } from "vitest"
import { CrashBudget } from "../src/crash-budget.js"

describe("CrashBudget (ZCode borrowing)", () => {
  it("restarts immediately on the first crash", () => {
    const budget = new CrashBudget()
    const d = budget.recordCrash(1_000)
    expect(d.allowRestart).toBe(true)
    expect(d.delayMs).toBe(1_000)
  })

  it("escalates backoff across crashes in the window", () => {
    const budget = new CrashBudget()
    const d1 = budget.recordCrash(0)
    const d2 = budget.recordCrash(2_000)
    expect(d1.delayMs).toBe(1_000)
    expect(d2.delayMs).toBe(5_000)
  })

  it("exhausts the budget within the window and stops restarting", () => {
    const budget = new CrashBudget()
    let t = 0
    let last: { allowRestart: boolean } | undefined
    for (let i = 0; i < 6; i++) {
      last = budget.recordCrash(t)
      t += 1_000
    }
    expect(last!.allowRestart).toBe(false)
    expect(last!.reason).toContain("exhausted")
  })

  it("prunes crashes older than the window (fresh budget after a healthy run)", () => {
    const budget = new CrashBudget()
    for (let i = 0; i < 5; i++) budget.recordCrash(i * 1_000)
    // 15 minutes later — the window (10 min) has pruned everything.
    const d = budget.recordCrash(15 * 60_000)
    expect(d.allowRestart).toBe(true)
    expect(d.delayMs).toBe(1_000)
  })
})
