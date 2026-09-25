import { afterEach, describe, expect, it, vi } from "vitest"
import * as React from "react"
import { EmptyState } from "../src/index.js"
import { cleanup, click, getByText, renderUI } from "./helpers.js"

afterEach(cleanup)

describe("EmptyState", () => {
  it("renders icon, title and description", () => {
    const { container } = renderUI(
      <EmptyState
        icon={<span data-testid="icon">i</span>}
        title="Nothing here"
        description="Create something to get started."
      />,
    )
    const root = container.querySelector('[data-component="empty-state"]')
    expect(root?.getAttribute("role")).toBe("status")
    expect(container.querySelector('[data-testid="icon"]')).not.toBeNull()
    expect(getByText(container, "Nothing here")).not.toBeNull()
    expect(getByText(container, "Create something to get started.")).not.toBeNull()
  })

  it("renders and fires the action slot", () => {
    const onClick = vi.fn()
    const { container } = renderUI(
      <EmptyState title="Nothing here" action={<button onClick={onClick}>Create item</button>} />,
    )
    click(getByText(container, "Create item"))
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
