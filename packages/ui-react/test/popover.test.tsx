import { afterEach, describe, expect, it, vi } from "vitest"
import * as React from "react"
import { Popover, PopoverContent, PopoverTrigger } from "../src/index.js"
import { cleanup, click, dispatch, flush, getByText, keyDown, renderUI } from "./helpers.js"

afterEach(cleanup)

function Demo({ onOpenChange }: { onOpenChange?: (open: boolean) => void }) {
  return (
    <Popover onOpenChange={onOpenChange}>
      <PopoverTrigger>Open popover</PopoverTrigger>
      <PopoverContent title="Hello popover">Body text</PopoverContent>
    </Popover>
  )
}

function openContent(): Element | null {
  return document.body.querySelector('[data-component="popover-content"]')
}

describe("Popover", () => {
  it("opens from the trigger and closes on an outside pointerdown", async () => {
    const onOpenChange = vi.fn()
    const { container } = renderUI(<Demo onOpenChange={onOpenChange} />)
    expect(openContent()).toBeNull()
    click(getByText(container, "Open popover"))
    expect(onOpenChange).toHaveBeenCalledWith(true)
    expect(openContent()?.textContent).toContain("Body text")
    // The dismiss layer attaches its document listeners in a macrotask...
    await flush()
    // ...and a left-button pointerdown defers dismissal to the next click.
    dispatch(document.body, new MouseEvent("pointerdown", { bubbles: true, button: 0 }))
    dispatch(document.body, new MouseEvent("click", { bubbles: true }))
    await flush()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("closes on Escape", () => {
    const onOpenChange = vi.fn()
    const { container } = renderUI(<Demo onOpenChange={onOpenChange} />)
    click(getByText(container, "Open popover"))
    expect(openContent()).not.toBeNull()
    keyDown(document, "Escape")
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
