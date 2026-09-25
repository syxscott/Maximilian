import { afterEach, describe, expect, it, vi } from "vitest"
import * as React from "react"
import { ResizableGrid, buildGridTemplate, resizeColumns } from "../src/index.js"
import { cleanup, keyDown, renderUI } from "./helpers.js"

afterEach(cleanup)

describe("resizeColumns", () => {
  it("moves weight between neighboring columns and clamps at the minimum", () => {
    expect(resizeColumns([1, 1, 1], 0, 0.3, 0.05)).toEqual([1.3, 0.7, 1])
    expect(resizeColumns([1, 1], 0, 1, 0.05)).toEqual([1.95, 0.05])
    expect(resizeColumns([1, 1], 0, -2, 0.05)).toEqual([0.05, 1.95])
  })

  it("ignores out-of-range boundaries and copies the input", () => {
    const sizes = [1, 1]
    expect(resizeColumns(sizes, 1, 0.5, 0.05)).toEqual([1, 1])
    expect(resizeColumns(sizes, -1, 0.5, 0.05)).toEqual([1, 1])
    expect(sizes).toEqual([1, 1])
  })
})

describe("buildGridTemplate", () => {
  it("interleaves fr tracks with handle tracks", () => {
    expect(buildGridTemplate([1])).toBe("1fr")
    expect(buildGridTemplate([1, 2, 3])).toBe("1fr 8px 2fr 8px 3fr")
    expect(buildGridTemplate([1, 2], 12)).toBe("1fr 12px 2fr")
  })
})

describe("ResizableGrid", () => {
  it("lays out children into columns with the computed template", () => {
    const { container } = renderUI(
      <ResizableGrid columns={[{ key: "a" }, { key: "b" }]} defaultSize={[1, 2]}>
        <div>Alpha</div>
        <div>Beta</div>
      </ResizableGrid>,
    )
    const root = container.querySelector('[data-component="resizable-grid"]') as HTMLElement
    expect(root.style.gridTemplateColumns).toBe("1fr 8px 2fr")
    const cells = container.querySelectorAll('[data-slot="resizable-grid-cell"]')
    expect(cells.length).toBe(2)
    expect(cells[0].textContent).toBe("Alpha")
    expect(cells[1].textContent).toBe("Beta")
  })

  it("resizes columns with the keyboard handles", () => {
    const onSizeChange = vi.fn()
    const { container } = renderUI(
      <ResizableGrid
        columns={[{ key: "a" }, { key: "b" }]}
        size={[1, 2]}
        onSizeChange={onSizeChange}
      >
        <div>Alpha</div>
        <div>Beta</div>
      </ResizableGrid>,
    )
    const handle = container.querySelector('[data-slot="resizable-grid-handle"]')
    expect(handle?.getAttribute("aria-valuenow")).toBe("33")
    keyDown(handle!, "ArrowRight")
    expect(onSizeChange).toHaveBeenLastCalledWith([1.05, 1.95])
    keyDown(handle!, "ArrowLeft")
    expect(onSizeChange).toHaveBeenLastCalledWith([0.95, 2.05])
  })
})
