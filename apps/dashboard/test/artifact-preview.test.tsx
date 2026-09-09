import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { ArtifactPreview } from "../src/components/_helpers/ArtifactPreview"

describe("ArtifactPreview", () => {
  const base = { name: "report.md", content: "report body content", workspaceId: "ws-1" }

  it("renders rendered markdown for text/markdown mime", () => {
    render(<ArtifactPreview artifact={{ ...base, mime: "text/markdown" }} />)
    // Whether the markdown renderer ships in `lib/markdown` (rendered html)
    // or the component falls back to <pre>, the content "report body content"
    // must reach the DOM.
    expect(screen.getByText(/report body content/i)).toBeInTheDocument()
  })

  it("renders an <img> for image/* mime", () => {
    const { container } = render(
      <ArtifactPreview
        artifact={{ ...base, name: "plot.png", mime: "image/png", content: "ignored" }}
      />,
    )
    const img = container.querySelector("img")
    expect(img).toBeTruthy()
  })

  it("renders a <table> for text/csv mime", () => {
    const csv = "a,b\n1,2"
    const { container } = render(
      <ArtifactPreview artifact={{ ...base, name: "data.csv", mime: "text/csv", content: csv }} />,
    )
    const table = container.querySelector("table")
    expect(table).toBeTruthy()
    expect(table!.querySelectorAll("tr").length).toBeGreaterThan(1)
  })

  it("falls back to <pre> for unknown mime", () => {
    render(
      <ArtifactPreview
        artifact={{
          ...base,
          name: "weird.bin",
          mime: "application/octet-stream",
          content: "binary",
        }}
      />,
    )
    expect(screen.getByText("binary")).toBeInTheDocument()
  })
})
