import { afterEach, describe, expect, it, vi } from "vitest"
import * as React from "react"
import { SplitPane, clampSize } from "../src/index.js"
import { cleanup, dispatch, keyDown, renderUI } from "./helpers.js"

afterEach(cleanup)

describe("clampSize", () => {
  it("clamps into [min, max] and survives inverted bounds", () => {
    expect(clampSize(0.5, 0.1, 0.9)).toBe(0.5)
    expect(clampSize(0.05, 0.1, 0.9)).toBe(0.1)
    expect(clampSize(0.95, 0.1, 0.9)).toBe(0.9)
    expect(clampSize(0.5, 0.9, 0.1)).toBe(0.5)
  })
})

describe("SplitPane", () => {
  it("renders both panes and reports keyboard resizes", () => {
    const onSizeChange = vi.fn()
    const { container } = renderUI(
      <SplitPane
        size={0.5}
        onSizeChange={onSizeChange}
        minSize={0.2}
        maxSize={0.8}
        first={<div>Left pane</div>}
        second={<div>Right pane</div>}
      />,
    )
    expect(container.textContent).toContain("Left pane")
    expect(container.textContent).toContain("Right pane")
    const handle = container.querySelector('[data-slot="split-pane-handle"]')
    expect(handle?.getAttribute("aria-valuenow")).toBe("50")
    keyDown(handle!, "ArrowRight")
    expect(onSizeChange).toHaveBeenLastCalledWith(0.55)
    keyDown(handle!, "End")
    expect(onSizeChange).toHaveBeenLastCalledWith(0.8)
    keyDown(handle!, "Home")
    expect(onSizeChange).toHaveBeenLastCalledWith(0.2)
  })

  it("resizes by pointer drag along the container", () => {
    const onSizeChange = vi.fn()
    const { container } = renderUI(
      <SplitPane
        size={0.5}
        onSizeChange={onSizeChange}
        first={<div>Left pane</div>}
        second={<div>Right pane</div>}
      />,
    )
    const root = container.querySelector('[data-component="split-pane"]')
    expect(root).not.toBeNull()
    if (!root) return
    vi.spyOn(root, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      right: 100,
      bottom: 100,
      width: 100,
      height: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect)

    const handle = container.querySelector('[data-slot="split-pane-handle"]')
    expect(handle).not.toBeNull()
    if (!handle) return
    dispatch(handle, new MouseEvent("mousedown", { bubbles: true, clientX: 50, clientY: 0 }))
    dispatch(document, new MouseEvent("mousemove", { clientX: 60, clientY: 0 }))
    expect(onSizeChange).toHaveBeenLastCalledWith(0.6)
    dispatch(document, new MouseEvent("mouseup"))
  })
})
