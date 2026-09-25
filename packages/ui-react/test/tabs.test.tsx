import { afterEach, describe, expect, it, vi } from "vitest"
import * as React from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../src/index.js"
import {
  cleanup,
  dispatch,
  flush,
  focus,
  getByText,
  keyDown,
  mouseDown,
  renderUI,
} from "./helpers.js"

afterEach(cleanup)

function renderTabs(props: Record<string, unknown> = {}) {
  return renderUI(
    <Tabs defaultValue="a" {...props}>
      <TabsList>
        <TabsTrigger value="a">Tab A</TabsTrigger>
        <TabsTrigger value="b">Tab B</TabsTrigger>
      </TabsList>
      <TabsContent value="a">Content A</TabsContent>
      <TabsContent value="b">Content B</TabsContent>
    </Tabs>,
  )
}

describe("Tabs", () => {
  it("renders the triggers and shows only the active panel", () => {
    const { container } = renderTabs()
    expect(getByText(container, "Tab A")).not.toBeNull()
    expect(getByText(container, "Tab B")).not.toBeNull()
    const active = container.querySelector('[data-slot="tabs-content"][data-state="active"]')
    expect(active?.textContent).toContain("Content A")
    const inactive = container.querySelector('[data-slot="tabs-content"][data-state="inactive"]')
    expect(inactive?.hasAttribute("hidden")).toBe(true)
  })

  it("switches panels on mousedown (radix activation)", () => {
    const onValueChange = vi.fn()
    const { container } = renderTabs({ onValueChange })
    mouseDown(getByText(container, "Tab B"))
    expect(onValueChange).toHaveBeenCalledWith("b")
  })

  it("moves the selection with the arrow keys", async () => {
    const onValueChange = vi.fn()
    const { container } = renderTabs({ onValueChange })
    const triggerA = getByText(container, "Tab A")
    focus(triggerA)
    keyDown(triggerA, "ArrowRight")
    // Roving focus resolves the next candidate in a macrotask.
    await flush()
    const triggerB = getByText(container, "Tab B")
    expect(document.activeElement).toBe(triggerB)
    // Automatic activation happens on focus.
    dispatch(triggerB, new FocusEvent("focusin", { bubbles: true }))
    expect(onValueChange).toHaveBeenCalledWith("b")
  })
})
