import { afterEach, describe, expect, it, vi } from "vitest"
import * as React from "react"
import { Breadcrumbs } from "../src/index.js"
import { cleanup, click, getByText, queryByText, renderUI } from "./helpers.js"

afterEach(cleanup)

const items = [
  { label: "Home", href: "/" },
  { label: "Library", onClick: () => {} },
  { label: "Data", href: "/data" },
  { label: "Current" },
]

describe("Breadcrumb / Breadcrumbs", () => {
  it("renders every item with the default separator", () => {
    const { container } = renderUI(<Breadcrumbs items={items} />)
    expect(container.querySelectorAll("li").length).toBe(4)
    expect(getByText(container, "Home")).not.toBeNull()
    expect(getByText(container, "Current")).not.toBeNull()
    expect(container.querySelectorAll("a").length).toBe(2)
  })

  it("collapses the middle items when maxItems is set", () => {
    const { container } = renderUI(<Breadcrumbs items={items} maxItems={3} />)
    expect(container.querySelectorAll("li").length).toBe(3)
    expect(queryByText(container, "Library")).toBeNull()
    expect(queryByText(container, "Data")).toBeNull()
    expect(getByText(container, "Home")).not.toBeNull()
    expect(getByText(container, "Current")).not.toBeNull()
  })

  it("supports a custom separator and click callbacks", () => {
    const onClick = vi.fn()
    const { container } = renderUI(
      <Breadcrumbs
        items={[{ label: "Home", href: "/" }, { label: "Library", onClick }, { label: "Current" }]}
        separator={<span data-testid="sep">/</span>}
      />,
    )
    expect(container.querySelectorAll('[data-testid="sep"]').length).toBe(2)
    click(getByText(container, "Library"))
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
