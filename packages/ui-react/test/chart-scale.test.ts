// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Chart scale helpers.
 *
 * (borrowing) Ported from the OpenAgentCore console `chart-scale.test.ts`,
 * extended with the tick-index and CJK label-width helpers the chart uses.
 */

import { describe, expect, it } from "vitest"
import { axisLabelWidth, niceTicks, tickIndices } from "../src/lib/chart-scale.js"

describe("chart ticks", () => {
  it("keeps count axes on whole numbers", () => {
    expect(niceTicks(1, 4, true)).toEqual([0, 1])
    expect(niceTicks(3, 4, true)).toEqual([0, 1, 2, 3])
    expect(niceTicks(9, 4, true)).toEqual([0, 5, 10])
    expect(niceTicks(10, 4, true)).toEqual([0, 5, 10])
    expect(niceTicks(10)).toEqual([0, 2.5, 5, 7.5, 10])
  })

  it("degenerates to a unit axis for non-positive or non-finite maxima", () => {
    expect(niceTicks(0)).toEqual([0, 1])
    expect(niceTicks(-5)).toEqual([0, 1])
    expect(niceTicks(Number.NaN)).toEqual([0, 1])
  })

  it("spreads fractional axes across the range", () => {
    expect(niceTicks(3, 4)).toEqual([0, 1, 2, 3])
    expect(niceTicks(7, 4)).toEqual([0, 2, 4, 6, 8])
  })
})

describe("tick indices", () => {
  it("returns every index within the budget", () => {
    expect(tickIndices(4, 6)).toEqual([0, 1, 2, 3])
    expect(tickIndices(0)).toEqual([])
  })

  it("samples evenly and always includes the last index", () => {
    expect(tickIndices(10, 4)).toEqual([0, 3, 6, 9])
    expect(tickIndices(7, 3)).toEqual([0, 3, 6])
  })
})

describe("axis label width", () => {
  it("prices latin digits and CJK glyphs differently", () => {
    expect(axisLabelWidth("100")).toBeCloseTo(19.2)
    expect(axisLabelWidth("千次")).toBe(22)
    expect(axisLabelWidth("a 千")).toBe(6.4 + 3 + 11)
  })
})
