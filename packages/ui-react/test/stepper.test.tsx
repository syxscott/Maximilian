import { afterEach, describe, expect, it, vi } from "vitest"
import * as React from "react"
import { Stepper, getStepState } from "../src/index.js"
import { cleanup, click, getByText, renderUI } from "./helpers.js"

afterEach(cleanup)

const steps = [{ label: "A" }, { label: "B" }, { label: "C" }]

describe("getStepState", () => {
  it("resolves completed / current / upcoming", () => {
    expect(getStepState(0, 1)).toBe("completed")
    expect(getStepState(1, 1)).toBe("current")
    expect(getStepState(2, 1)).toBe("upcoming")
  })
})

describe("Stepper", () => {
  it("renders the three states and marks the current step", () => {
    const { container } = renderUI(<Stepper steps={steps} current={1} />)
    expect(
      container.querySelector('[data-slot="stepper-step"][data-state="completed"]'),
    ).not.toBeNull()
    const current = container.querySelector('[data-slot="stepper-step"][data-state="current"]')
    expect(current?.getAttribute("aria-current")).toBe("step")
    expect(current?.textContent).toContain("B")
    expect(
      container.querySelector('[data-slot="stepper-step"][data-state="upcoming"]'),
    ).not.toBeNull()
  })

  it("navigates by clicking when clickable", () => {
    const onStepChange = vi.fn()
    const { container } = renderUI(
      <Stepper steps={steps} current={2} clickable onStepChange={onStepChange} />,
    )
    click(getByText(container, "A"))
    expect(onStepChange).toHaveBeenCalledWith(0)
  })

  it("does not render buttons when not clickable", () => {
    const { container } = renderUI(<Stepper steps={steps} current={0} />)
    expect(container.querySelector('[data-slot="stepper-button"]')).toBeNull()
    expect(container.textContent).toContain("A")
  })
})
