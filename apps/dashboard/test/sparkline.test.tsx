import { describe, it, expect } from "vitest"
import { render } from "@testing-library/react"
import { Sparkline } from "../src/components/_helpers/Sparkline"

describe("Sparkline", () => {
  it("renders an empty SVG when given zero values", () => {
    const { container } = render(<Sparkline values={[]} />)
    const svg = container.querySelector("svg")
    expect(svg).toBeTruthy()
    expect(svg!.querySelector("polyline")).toBeNull()
  })

  it("renders a polyline for non-empty values", () => {
    const { container } = render(<Sparkline values={[1, 3, 2, 4, 5, 3]} />)
    const polyline = container.querySelector("polyline")
    expect(polyline).toBeTruthy()
    expect(polyline!.getAttribute("points")).toMatch(/^[\d., ]+$/)
    const pts = (polyline!.getAttribute("points") ?? "").trim().split(/\s+/).length
    expect(pts).toBe(6)
  })

  it("uses a single dot for a one-element array", () => {
    const { container } = render(<Sparkline values={[7]} />)
    expect(container.querySelectorAll("circle").length).toBe(1)
  })

  it("applies custom width/height/stroke", () => {
    const { container } = render(
      <Sparkline values={[1, 2, 3]} width={120} height={32} stroke="#abc" />,
    )
    const svg = container.querySelector("svg")!
    expect(svg.getAttribute("width")).toBe("120")
    expect(svg.getAttribute("height")).toBe("32")
    expect(svg.querySelector("polyline")!.getAttribute("stroke")).toBe("#abc")
  })
})
