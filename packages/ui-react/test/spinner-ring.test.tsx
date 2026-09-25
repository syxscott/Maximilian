import { afterEach, describe, expect, it } from "vitest"
import * as React from "react"
import { SpinnerRing } from "../src/index.js"
import { cleanup, renderUI } from "./helpers.js"

afterEach(cleanup)

describe("SpinnerRing", () => {
  it("renders a labelled status ring with size and speed variants", () => {
    const { container } = renderUI(<SpinnerRing size="lg" speed="fast" />)
    const svg = container.querySelector("svg")
    expect(svg?.getAttribute("role")).toBe("status")
    expect(svg?.getAttribute("aria-label")).toBe("Loading")
    expect(svg?.getAttribute("data-size")).toBe("lg")
    expect(svg?.getAttribute("data-speed")).toBe("fast")
    expect(svg?.classList.contains("h-8")).toBe(true)
    expect(svg?.style.animationDuration).toBe("0.45s")
    expect(container.querySelector('[data-slot="spinner-ring-track"]')).not.toBeNull()
    expect(container.querySelector('[data-slot="spinner-ring-arc"]')).not.toBeNull()
  })

  it("supports a custom accessible label and extra svg props", () => {
    const { container } = renderUI(<SpinnerRing label="Saving" data-testid="ring" />)
    const svg = container.querySelector('[data-testid="ring"]')
    expect(svg).not.toBeNull()
    expect(svg?.getAttribute("aria-label")).toBe("Saving")
    expect(svg?.getAttribute("data-speed")).toBe("normal")
  })
})
