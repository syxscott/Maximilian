// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * ContextMeter tests (local chars/4 estimate): ring geometry from the
 * estimate, the click-open breakdown (draft / session split), the ≥80%
 * warning tone and the no-data → no-render rule.
 */

import { describe, it, expect, afterEach } from "vitest"
import { render, screen, cleanup, fireEvent } from "@testing-library/react"
import { getDictionary, setLocale } from "@max/i18n"
import { applyDashboardDictionaries } from "../src/locales/index"
import { ContextMeter } from "../src/components/composer/ContextMeter"
import {
  contextOccupancyModel,
  estimateTokensFromChars,
  sessionCharsFromEvents,
  CONTEXT_LIMIT_TOKENS,
  CONTEXT_WARN_PERCENT,
} from "../src/components/composer/context.model"
import type { RuntimeEvent } from "../src/api"

applyDashboardDictionaries(getDictionary("zh-CN") ?? {}, getDictionary("en-US") ?? {})
setLocale("en-US")

afterEach(() => cleanup())

const evx = (over: Record<string, unknown>): RuntimeEvent =>
  ({ type: "unknown", ...over }) as RuntimeEvent

describe("estimate model", () => {
  it("estimateTokensFromChars is chars/4 rounded up; zero-ish input is 0", () => {
    expect(estimateTokensFromChars(0)).toBe(0)
    expect(estimateTokensFromChars(1)).toBe(1)
    expect(estimateTokensFromChars(400)).toBe(100)
    expect(estimateTokensFromChars(401)).toBe(101)
    expect(estimateTokensFromChars(Number.NaN)).toBe(0)
  })

  it("sessionCharsFromEvents sums the JSON length of every event", () => {
    const events = [evx({ type: "task-start", taskId: "t1" }), evx({ type: "tool-end" })]
    expect(sessionCharsFromEvents(events)).toBe(
      events.reduce((acc, e) => acc + JSON.stringify(e).length, 0),
    )
  })

  it("contextOccupancyModel splits draft/session, clamps the ring and flags warn", () => {
    // 400 chars draft = 100 tokens; 439,600 chars session = 109,900 tokens.
    const near = contextOccupancyModel(400, 439_600, 120_000)
    expect(near.draftTokens).toBe(100)
    expect(near.sessionTokens).toBe(109_900)
    expect(near.totalTokens).toBe(110_000)
    expect(near.rawPercent).toBe(92)
    expect(near.percent).toBe(92)
    expect(near.warn).toBe(true)

    // Over the limit: raw percent keeps counting, ring clamps to 100.
    const over = contextOccupancyModel(400, 1_600_000, 120_000)
    expect(over.rawPercent).toBeGreaterThan(100)
    expect(over.percent).toBe(100)

    // Under the warn threshold.
    const low = contextOccupancyModel(400, 20_000)
    expect(low.warn).toBe(false)
    expect(low.totalTokens).toBe(100 + Math.ceil(20_000 / 4))
    expect(low.limit).toBe(CONTEXT_LIMIT_TOKENS)

    // A hostile limit falls back to the constant.
    expect(contextOccupancyModel(400, 0, Number.NaN).limit).toBe(CONTEXT_LIMIT_TOKENS)
    expect(CONTEXT_WARN_PERCENT).toBe(80)
  })
})

describe("ContextMeter rendering", () => {
  it("renders nothing without data (no draft, no events)", () => {
    const { container } = render(<ContextMeter draftText="" events={[]} />)
    expect(container.querySelector("[data-testid=context-meter]")).toBeNull()
  })

  it("shows the ring + percent and opens the draft/session breakdown", () => {
    const draft = "a".repeat(400) // 100 tokens
    const events = [evx({ type: "tool-end", output: "b".repeat(20_000) })]
    const { getByTestId } = render(<ContextMeter draftText={draft} events={events} />)
    const trigger = getByTestId("context-meter-trigger")
    const percent = getByTestId("context-percent")
    expect(percent).toHaveTextContent(/^\d+%$/)
    const raw = Number.parseInt(percent.textContent ?? "0", 10)
    expect(raw).toBeGreaterThan(0)
    // Ring geometry: dasharray encodes the clamped percent of the circumference.
    const ring = getByTestId("context-meter-ring")
    const dash = Number.parseFloat(ring.getAttribute("stroke-dasharray")?.split(" ")[0] ?? "0")
    const circumference = 2 * Math.PI * 5.5
    expect(dash).toBeCloseTo((circumference * Math.min(100, raw)) / 100, 1)

    // Breakdown panel opens on click with both segments.
    expect(screen.queryByTestId("context-breakdown")).toBeNull()
    fireEvent.click(trigger)
    const breakdown = screen.getByTestId("context-breakdown")
    expect(breakdown).toBeInTheDocument()
    // Draft = exactly 100 tokens; session ≈ 20k chars ÷ 4 (plus event JSON
    // overhead) → ~5k tokens.
    expect(getByTestId("context-breakdown-draft")).toHaveTextContent("100")
    expect(getByTestId("context-breakdown-session").textContent).toMatch(/^~5[\d.,]*K?$/i)
    expect(getByTestId("context-breakdown-session")).toHaveTextContent("5")
    // Escape closes it.
    fireEvent.keyDown(document, { key: "Escape" })
    expect(screen.queryByTestId("context-breakdown")).toBeNull()
  })

  it("turns the warning tone on past 80% and keeps the muted tone below", () => {
    // 92% occupancy.
    const draft = "a".repeat(400)
    const events = [evx({ type: "tool-end", output: "b".repeat(439_600) })]
    const { getByTestId, unmount } = render(<ContextMeter draftText={draft} events={events} />)
    const trigger = getByTestId("context-meter-trigger")
    expect(
      Number.parseInt(getByTestId("context-percent").textContent ?? "0", 10),
    ).toBeGreaterThanOrEqual(80)
    expect(trigger.className).toContain("amber")
    expect(getByTestId("context-meter-ring").getAttribute("class")).toContain("amber")
    unmount()

    // Tiny occupancy — muted tone, no amber anywhere.
    const smallDraft = "a".repeat(400)
    const small = render(<ContextMeter draftText={smallDraft} events={[]} />)
    expect(small.getByTestId("context-percent")).toHaveTextContent("0%")
    expect(small.getByTestId("context-meter-trigger").className).not.toContain("amber")
  })
})
