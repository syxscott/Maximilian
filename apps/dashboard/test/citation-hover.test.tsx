// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Citation hover-preview chain tests: the 300ms hover gate opens a PORTAL
 * card, the card flips above the trigger when there is no room below,
 * mouse-leave closes it after the leave delay, citations WITHOUT a URL
 * never enable hover, and the two consumers (search renderer, WebSearch
 * block) inherit the behavior from their citation data.
 */

import { describe, it, expect, vi, afterEach, beforeAll } from "vitest"
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react"
import { getDictionary, setLocale } from "@max/i18n"
import { applyDashboardDictionaries } from "../src/locales/index"
import { CitationBlock } from "../src/components/ai-elements/CitationBlock"
import { WebSearchBlock } from "../src/components/ai-elements/WebSearchBlock"
import { SearchBody } from "../src/components/tool-renderers/renderers/search"
import { anchoredPositionFor } from "./helpers/anchored"

// Register the dashboard domain dictionaries exactly like main.tsx.
applyDashboardDictionaries(getDictionary("zh-CN") ?? {}, getDictionary("en-US") ?? {})
setLocale("en-US")

// jsdom lacks ResizeObserver (anchored.ts's open-tracking) — minimal stub.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
beforeAll(() => {
  Object.defineProperty(globalThis, "ResizeObserver", {
    value: ResizeObserverStub,
    configurable: true,
  })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe("CitationBlock hover preview", () => {
  it("opens the portal card after a 300ms hover; leave closes after 100ms", () => {
    vi.useFakeTimers()
    render(
      <CitationBlock
        citation={{
          index: 3,
          title: "Rust async deep dive",
          url: "https://blog.example.com/rust-async",
          siteName: "Example Blog",
          snippet: "How the executor polls futures.",
          publishedAt: "2026-05-01",
        }}
      />,
    )
    const trigger = screen.getByTestId("citation-block")
    expect(trigger).toHaveAttribute("data-hover-preview", "true")
    expect(document.querySelector("[data-testid=hover-card]")).toBeNull()

    fireEvent.mouseEnter(trigger)
    // Before the gate: nothing yet.
    act(() => {
      vi.advanceTimersByTime(299)
    })
    expect(document.querySelector("[data-testid=hover-card]")).toBeNull()
    act(() => {
      vi.advanceTimersByTime(1)
    })
    const card = document.querySelector("[data-testid=hover-card]")
    expect(card).not.toBeNull()
    // Card content: site name, title, snippet (date via formatDate).
    const preview = screen.getByTestId("citation-preview-card")
    expect(preview).toHaveTextContent("Example Blog")
    expect(preview).toHaveTextContent("Rust async deep dive")
    expect(preview).toHaveTextContent("How the executor polls futures.")
    expect(preview).toHaveAttribute("href", "https://blog.example.com/rust-async")
    expect(preview).toHaveAttribute("target", "_blank")

    // Moving INTO the card cancels the pending close.
    fireEvent.mouseLeave(trigger)
    act(() => {
      vi.advanceTimersByTime(100)
    })
    expect(document.querySelector("[data-testid=hover-card]")).toBeNull()
  })

  it("flips above the trigger when there is no room below", () => {
    vi.useFakeTimers()
    render(
      <CitationBlock
        citation={{ index: 1, title: "Near bottom", url: "https://a.example.com/x" }}
      />,
    )
    const trigger = screen.getByTestId("citation-block")
    // Trigger sits at the very bottom of the 768px jsdom viewport.
    anchoredPositionFor(trigger, { top: 740, bottom: 760, left: 100, width: 80 })
    fireEvent.mouseEnter(trigger)
    act(() => {
      vi.advanceTimersByTime(300)
    })
    const card = document.querySelector("[data-testid=hover-card]") as HTMLElement
    expect(card).not.toBeNull()
    const top = Number.parseFloat(card.style.top)
    // Above the trigger (flipped side), not below its bottom edge.
    expect(top).toBeLessThan(740)
    // And clamped inside the viewport padding.
    expect(top).toBeGreaterThanOrEqual(8)
  })

  it("stays below when the space underneath fits the card", () => {
    vi.useFakeTimers()
    render(
      <CitationBlock citation={{ index: 1, title: "Top page", url: "https://a.example.com/y" }} />,
    )
    const trigger = screen.getByTestId("citation-block")
    anchoredPositionFor(trigger, { top: 100, bottom: 120, left: 100, width: 80 })
    fireEvent.mouseEnter(trigger)
    act(() => {
      vi.advanceTimersByTime(300)
    })
    const card = document.querySelector("[data-testid=hover-card]") as HTMLElement
    expect(Number.parseFloat(card.style.top)).toBeGreaterThan(120)
  })

  it("does NOT enable hover for a citation without a URL", () => {
    vi.useFakeTimers()
    render(<CitationBlock citation={{ index: 2, title: "No link source" }} />)
    const trigger = screen.getByTestId("citation-block")
    expect(trigger).toHaveAttribute("data-hover-preview", "false")
    fireEvent.mouseEnter(trigger)
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(document.querySelector("[data-testid=hover-card]")).toBeNull()
  })

  it("disableHover opts out even when a URL exists", () => {
    vi.useFakeTimers()
    render(
      <CitationBlock
        citation={{ index: 4, title: "X", url: "https://a.example.com/z" }}
        disableHover
      />,
    )
    const trigger = screen.getByTestId("citation-block")
    expect(trigger).toHaveAttribute("data-hover-preview", "false")
    fireEvent.mouseEnter(trigger)
    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(document.querySelector("[data-testid=hover-card]")).toBeNull()
  })

  it("keeps native new-tab semantics on the title anchor", () => {
    render(<CitationBlock citation={{ index: 1, title: "T", url: "https://a.example.com/1" }} />)
    const anchor = screen.getByText("T").closest("a")
    expect(anchor).toHaveAttribute("target", "_blank")
    expect(anchor).toHaveAttribute("rel", "noopener noreferrer")
  })
})

describe("search renderer hover citations", () => {
  it("passes http(s) hit URLs through; URL-less hits keep the static chip", () => {
    vi.useFakeTimers()
    render(
      <SearchBody
        tool="search"
        input={{
          query: "async rust",
          results: [
            { title: "Tokio tutorial", url: "https://tokio.rs/tutorial" },
            { title: "Opaque hit" },
            { title: "Sneaky", url: "javascript:alert(1)" },
          ],
        }}
      />,
    )
    const chips = screen.getAllByTestId("citation-block")
    expect(chips).toHaveLength(3)
    expect(chips[0]).toHaveAttribute("data-hover-preview", "true")
    expect(chips[1]).toHaveAttribute("data-hover-preview", "false")
    // A javascript: URL is not a safe external link — static chip.
    expect(chips[2]).toHaveAttribute("data-hover-preview", "false")
    // Hovering the first chip shows the source card from the hit payload.
    fireEvent.mouseEnter(chips[0] as Element)
    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(screen.getByTestId("citation-preview-card")).toHaveTextContent("Tokio tutorial")
  })
})

describe("WebSearchBlock hover previews", () => {
  it("gives URL-bearing results the hover card with domain + snippet", () => {
    vi.useFakeTimers()
    render(
      <WebSearchBlock
        search={{
          query: "context compaction",
          results: [
            {
              title: "Compaction strategies",
              url: "https://docs.example.com/compaction",
              domain: "docs.example.com",
              snippet: "Summarize early turns.",
            },
            { title: "No-url result", domain: "example.org" },
          ],
        }}
      />,
    )
    const links = screen.getAllByTestId("websearch-result-link")
    expect(links).toHaveLength(1)
    fireEvent.mouseEnter(links[0])
    act(() => {
      vi.advanceTimersByTime(300)
    })
    const preview = screen.getByTestId("citation-preview-card")
    expect(preview).toHaveTextContent("docs.example.com")
    expect(preview).toHaveTextContent("Summarize early turns.")
    expect(preview).toHaveTextContent("Compaction strategies")
    // The URL-less row never gets a hover affordance: exactly one portal
    // (the websearch-scoped testid), zero default-named hover cards.
    expect(screen.getAllByTestId("websearch-preview-card")).toHaveLength(1)
    expect(screen.queryAllByTestId("hover-card")).toHaveLength(0)
  })
})
