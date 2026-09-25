import { afterEach, describe, expect, it, vi } from "vitest"
import * as React from "react"
import { Slider } from "../src/index.js"
import { cleanup, keyDown, renderUI } from "./helpers.js"

afterEach(cleanup)

describe("Slider", () => {
  it("renders the controlled value on the thumb", () => {
    const onValueChange = vi.fn()
    const { container } = renderUI(
      <Slider min={0} max={100} step={1} value={[50]} onValueChange={onValueChange} />,
    )
    const thumb = container.querySelector('[role="slider"]')
    expect(thumb).not.toBeNull()
    expect(thumb?.getAttribute("aria-valuenow")).toBe("50")
    expect(thumb?.getAttribute("aria-valuemin")).toBe("0")
    expect(thumb?.getAttribute("aria-valuemax")).toBe("100")
  })

  it("steps from the keyboard", () => {
    const onValueChange = vi.fn()
    const { container } = renderUI(
      <Slider min={0} max={100} step={5} value={[50]} onValueChange={onValueChange} />,
    )
    const thumb = container.querySelector('[role="slider"]')
    keyDown(thumb!, "ArrowRight")
    expect(onValueChange).toHaveBeenLastCalledWith([55])
    keyDown(thumb!, "ArrowLeft")
    expect(onValueChange).toHaveBeenLastCalledWith([45])
  })
})
