import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { WaveIndicator } from "../src/components/_helpers/WaveIndicator"

const baseWaves = [
  { status: "done" as const, tickCount: 3 },
  { status: "done" as const, tickCount: 2 },
  { status: "active" as const, tickCount: 4, activeCount: 2 },
  { status: "queued" as const, tickCount: 1 },
]

describe("WaveIndicator", () => {
  it("renders the total tick count", () => {
    render(<WaveIndicator waves={baseWaves} />)
    const ticks = screen.getAllByTestId("wave-tick")
    expect(ticks.length).toBe(10)
  })

  it("marks active wave with active class only on its ticks", () => {
    const { container } = render(<WaveIndicator waves={baseWaves} />)
    const activeTicks = container.querySelectorAll(".wave-indicator__tick--active")
    expect(activeTicks.length).toBe(4)
  })

  it("shows the wave counter label", () => {
    render(<WaveIndicator waves={baseWaves} />)
    expect(screen.getByText(/wave\s*3\s*\/\s*4/i)).toBeInTheDocument()
  })

  it("shows parallel active count when non-zero", () => {
    render(<WaveIndicator waves={baseWaves} />)
    expect(screen.getByText(/2\s*parallel\s*active/i)).toBeInTheDocument()
  })

  it("renders nothing for an empty wave list", () => {
    const { container } = render(<WaveIndicator waves={[]} />)
    expect(container.querySelectorAll("[data-testid='wave-tick']").length).toBe(0)
    expect(screen.queryByText(/wave\s*\/\s*/i)).toBeNull()
  })
})
