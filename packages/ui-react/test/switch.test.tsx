import { afterEach, describe, expect, it, vi } from "vitest"
import * as React from "react"
import { Switch, Toggle } from "../src/index.js"
import { cleanup, click, renderUI } from "./helpers.js"

afterEach(cleanup)

describe("Switch / Toggle", () => {
  it("reflects the checked state via aria-checked", () => {
    const onCheckedChange = vi.fn()
    const { container } = renderUI(
      <Switch checked onCheckedChange={onCheckedChange}>
        Wi-Fi
      </Switch>,
    )
    const control = container.querySelector('[role="switch"]')
    expect(control).not.toBeNull()
    expect(control?.getAttribute("aria-checked")).toBe("true")
    expect(container.textContent).toContain("Wi-Fi")
  })

  it("toggles on click and notifies (exposed as Toggle)", () => {
    const onCheckedChange = vi.fn()
    const { container } = renderUI(<Toggle onCheckedChange={onCheckedChange}>Wi-Fi</Toggle>)
    const control = container.querySelector('[role="switch"]')
    expect(control?.getAttribute("aria-checked")).toBe("false")
    click(control!)
    expect(onCheckedChange).toHaveBeenCalledWith(true)
    expect(control?.getAttribute("aria-checked")).toBe("true")
  })
})
