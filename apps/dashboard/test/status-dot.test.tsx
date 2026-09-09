import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { StatusDot } from "../src/components/_helpers/StatusDot"

describe("StatusDot", () => {
  it("renders an accessible label for each status", () => {
    for (const status of ["idle", "running", "done", "error"] as const) {
      const { unmount } = render(<StatusDot status={status} />)
      expect(screen.getByRole("status")).toHaveAttribute(
        "aria-label",
        expect.stringMatching(new RegExp(status, "i")),
      )
      unmount()
    }
  })

  it("applies the running class only when status is running", () => {
    const { rerender } = render(<StatusDot status="idle" />)
    expect(screen.getByRole("status").className).not.toMatch(/status-dot--running/)
    rerender(<StatusDot status="running" />)
    expect(screen.getByRole("status").className).toMatch(/status-dot--running/)
    rerender(<StatusDot status="done" />)
    expect(screen.getByRole("status").className).not.toMatch(/status-dot--running/)
  })

  it("exposes sr-only text for screen readers", () => {
    render(<StatusDot status="running" />)
    expect(screen.getByText(/running/i, { selector: "span" })).toHaveClass("sr-only")
  })
})
