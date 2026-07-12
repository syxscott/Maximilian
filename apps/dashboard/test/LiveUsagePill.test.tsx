import "@testing-library/jest-dom/vitest"
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { LiveUsagePill } from "../src/components/LiveUsagePill"

vi.mock("../src/hooks/useLiveUsage", () => ({
  useLiveUsage: () => ({
    data: {
      totalRequests: 7,
      totalTokens: 12340,
      totalCostUsd: 0.1234,
      cacheHitRate: 0.42,
      cacheReadTokens: 1000,
    },
    isLoading: false,
    isError: false,
  }),
}))

describe("LiveUsagePill", () => {
  it("renders the cost + token summary", () => {
    render(<LiveUsagePill onOpenUsage={() => {}} />)
    expect(screen.getByText(/\$0\.1234/)).toBeInTheDocument()
    expect(screen.getByText(/12\.3K|tokens/i)).toBeInTheDocument()
  })

  it("renders the popover trigger as a button", () => {
    render(<LiveUsagePill onOpenUsage={() => {}} />)
    expect(screen.getByRole("button")).toBeInTheDocument()
  })

  it("renders a sparkline when popover is opened", async () => {
    const user = userEvent.setup()
    render(<LiveUsagePill onOpenUsage={() => {}} />)
    await user.click(screen.getByRole("button"))
    expect(document.querySelector("svg polyline")).toBeTruthy()
  })
})
