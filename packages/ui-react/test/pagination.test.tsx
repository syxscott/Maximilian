import { afterEach, describe, expect, it, vi } from "vitest"
import * as React from "react"
import { Pagination, buildPageList } from "../src/index.js"
import { cleanup, click, renderUI } from "./helpers.js"

afterEach(cleanup)

describe("buildPageList", () => {
  it("returns every page when they all fit", () => {
    expect(buildPageList(3, 7, 1)).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it("windows around the current page with ellipses", () => {
    expect(buildPageList(1, 20, 1)).toEqual([1, 2, 3, 4, 5, "ellipsis", 20])
    expect(buildPageList(10, 20, 1)).toEqual([1, "ellipsis", 9, 10, 11, "ellipsis", 20])
    expect(buildPageList(20, 20, 1)).toEqual([1, "ellipsis", 15, 16, 17, 18, 19, 20])
  })
})

describe("Pagination", () => {
  it("shows the page counter and page buttons", () => {
    const { container } = renderUI(
      <Pagination page={2} pageSize={10} total={100} showPageSize={false} />,
    )
    expect(container.textContent).toContain("Page 2 of 10")
    const current = container.querySelector('[aria-current="page"]')
    expect(current?.textContent).toBe("2")
  })

  it("navigates through next/prev and disables at the edges", () => {
    const onPageChange = vi.fn()
    const first = renderUI(
      <Pagination page={1} pageSize={10} total={100} onPageChange={onPageChange} />,
    )
    const prev = first.container.querySelector<HTMLButtonElement>('[aria-label="Previous page"]')
    expect(prev?.disabled).toBe(true)
    const next = first.container.querySelector<HTMLButtonElement>('[aria-label="Next page"]')
    click(next!)
    expect(onPageChange).toHaveBeenCalledWith(2)

    const last = renderUI(
      <Pagination page={10} pageSize={10} total={100} onPageChange={onPageChange} />,
    )
    const nextOnLast = last.container.querySelector<HTMLButtonElement>('[aria-label="Next page"]')
    expect(nextOnLast?.disabled).toBe(true)
    const prevOnLast = last.container.querySelector<HTMLButtonElement>(
      '[aria-label="Previous page"]',
    )
    click(prevOnLast!)
    expect(onPageChange).toHaveBeenCalledWith(9)
  })
})
