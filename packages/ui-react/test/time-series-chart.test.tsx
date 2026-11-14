// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * TimeSeriesChart behavior: bucket tooltip via keyboard, the accessible data
 * table toggle, and the a11y live region.
 */

import { afterEach, describe, expect, it } from "vitest"
import { cleanup, click, flush, focus, keyDown, renderUI } from "./helpers.js"
import { TimeSeriesChart } from "../src/components/time-series-chart.js"
import type { TimeSeries } from "../src/components/time-series-chart.js"

afterEach(cleanup)

const buckets = [1700000000, 1700003600, 1700007200]
const series: TimeSeries[] = [
  { id: "a", label: "Alpha", color: "#111", values: [1, 2, 3], total: "6" },
  { id: "b", label: "Beta", color: "#222", values: [0, null, 4] },
]

function chart() {
  return (
    <TimeSeriesChart
      label="Requests per hour"
      kind="columns"
      stacked
      buckets={buckets}
      bucketSeconds={3600}
      series={series}
      formatValue={(value) => `${value}`}
    />
  )
}

describe("TimeSeriesChart", () => {
  it("renders the legend, gridlines and bars", () => {
    const view = renderUI(chart())
    expect(view.container.querySelectorAll(".chart-bar")).toHaveLength(buckets.length)
    expect(view.container.textContent).toContain("Alpha")
    expect(view.container.textContent).toContain("6")
    view.unmount()
  })

  it("moves the tooltip with arrow keys and announces it through the live region", () => {
    const view = renderUI(chart())
    const plot = view.container.querySelector("[role='group']") as HTMLElement
    focus(plot)
    keyDown(plot, "ArrowRight")
    expect(view.container.querySelector(".chart-band-highlight")).not.toBeNull()
    const live = view.container.querySelector("[aria-live='polite']")
    expect(live?.textContent).toContain("Alpha 1")
    keyDown(plot, "ArrowLeft")
    keyDown(plot, "ArrowLeft")
    // Clamped at the first bucket.
    expect(live?.textContent).toContain("Alpha 1")
    keyDown(plot, "Escape")
    expect(view.container.querySelector(".chart-band-highlight")).toBeNull()
    view.unmount()
  })

  it("toggles the accessible data table", () => {
    const view = renderUI(chart())
    expect(view.container.querySelector("table")).toBeNull()
    const toggle = [...view.container.querySelectorAll("button")].find((el) =>
      /view data table/i.test(el.getAttribute("aria-label") ?? ""),
    )
    expect(toggle).toBeDefined()
    click(toggle as HTMLButtonElement)
    const table = view.container.querySelector("table")
    expect(table).not.toBeNull()
    expect(table?.querySelector("caption")?.textContent).toBe("Requests per hour")
    expect(table?.textContent).toContain("Alpha")
    expect(table?.textContent).toContain("—")
    // Pressing again hides it.
    click(toggle as HTMLButtonElement)
    expect(view.container.querySelector("table")).toBeNull()
    view.unmount()
  })

  it("shows the empty state when no series carries values", () => {
    const view = renderUI(
      <TimeSeriesChart
        label="Empty"
        kind="lines"
        buckets={buckets}
        bucketSeconds={3600}
        series={[{ id: "x", label: "X", color: "#333", values: [null, null, null] }]}
        formatValue={(value) => `${value}`}
        labels={{ noData: "nothing here" }}
      />,
    )
    expect(view.container.textContent).toContain("nothing here")
    view.unmount()
  })

  it("draws line paths with end dots for the lines kind", async () => {
    const view = renderUI(
      <TimeSeriesChart
        label="Lines"
        kind="lines"
        buckets={buckets}
        bucketSeconds={3600}
        series={series}
        formatValue={(value) => `${value}`}
      />,
    )
    await flush()
    expect(view.container.querySelectorAll(".chart-line")).toHaveLength(2)
    expect(view.container.querySelectorAll(".chart-last-dot")).toHaveLength(2)
    view.unmount()
  })
})
