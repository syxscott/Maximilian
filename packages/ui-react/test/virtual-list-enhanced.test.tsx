import { afterEach, describe, expect, it, vi } from "vitest"
import * as React from "react"
import {
  VirtualListEnhanced,
  computeVisibleRange,
  type ComputeVisibleRangeOptions,
} from "../src/index.js"
import { cleanup, dispatch, renderUI } from "./helpers.js"

afterEach(cleanup)

const items: string[] = Array.from({ length: 100 }, (_, i) => `Item ${i}`)

function options(overrides: Partial<ComputeVisibleRangeOptions> = {}): ComputeVisibleRangeOptions {
  return {
    itemCount: 100,
    scrollOffset: 0,
    viewportHeight: 200,
    estimatedHeights: Array.from({ length: 100 }, () => 20),
    overscan: 3,
    ...overrides,
  }
}

describe("computeVisibleRange", () => {
  it("windows around the scroll offset with overscan", () => {
    const atTop = computeVisibleRange(options())
    expect(atTop.startIndex).toBe(0)
    expect(atTop.stopIndex).toBe(12)
    expect(atTop.totalHeight).toBe(2000)

    const scrolled = computeVisibleRange(options({ scrollOffset: 400 }))
    expect(scrolled.startIndex).toBe(17)
    expect(scrolled.stopIndex).toBe(32)
    expect(scrolled.padStart).toBe(340)
  })

  it("prefers measured heights over estimates and handles the empty list", () => {
    const measured = computeVisibleRange(options({ measuredHeights: { 0: 100 } }))
    expect(measured.totalHeight).toBe(2080)
    expect(measured.offsets[1]).toBe(100)

    const empty = computeVisibleRange(options({ itemCount: 0 }))
    expect(empty.stopIndex).toBe(-1)
    expect(empty.totalHeight).toBe(0)
  })
})

describe("VirtualListEnhanced", () => {
  function renderList(props: Record<string, unknown> = {}) {
    return renderUI(
      <VirtualListEnhanced
        items={items}
        height={200}
        viewportHeight={200}
        estimateItemHeight={() => 20}
        overscan={3}
        renderItem={(item) => <div>{item}</div>}
        {...props}
      />,
    )
  }

  it("renders only the visible window and sizes the inner spacer", () => {
    const { container } = renderList()
    const rendered = container.querySelectorAll('[data-slot="virtual-list-item"]')
    expect(rendered.length).toBe(13)
    const inner = container.querySelector<HTMLElement>('[data-slot="virtual-list-inner"]')
    expect(inner?.style.height).toBe("2000px")
    expect(container.textContent).toContain("Item 0")
    expect(container.textContent).not.toContain("Item 50")
  })

  it("moves the window when the list is scrolled", () => {
    const onRangeChange = vi.fn()
    const { container } = renderList({ onRangeChange })
    const scroller = container.querySelector<HTMLElement>(
      '[data-component="virtual-list-enhanced"]',
    )
    expect(scroller).not.toBeNull()
    if (!scroller) return
    scroller.scrollTop = 400
    dispatch(scroller, new Event("scroll", { bubbles: true }))
    expect(container.textContent).toContain("Item 20")
    expect(container.textContent).not.toContain("Item 0")
    expect(onRangeChange).toHaveBeenLastCalledWith({ startIndex: 17, stopIndex: 32 })
  })
})
