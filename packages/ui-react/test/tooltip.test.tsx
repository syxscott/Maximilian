import { afterEach, describe, expect, it } from "vitest"
import * as React from "react"
import {
  Tooltip,
  TooltipContent,
  TooltipKeybind,
  TooltipProvider,
  TooltipTrigger,
} from "../src/index.js"
import { cleanup, renderUI } from "./helpers.js"

afterEach(cleanup)

function Tip({ open = false }: { open?: boolean }) {
  return (
    <TooltipProvider>
      <Tooltip open={open}>
        <TooltipTrigger>Hover me</TooltipTrigger>
        <TooltipContent>The tip text</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

describe("Tooltip", () => {
  it("hides the content by default and shows it when open", () => {
    const { container, rerender } = renderUI(<Tip />)
    expect(container.textContent).toContain("Hover me")
    expect(document.body.querySelector('[data-component="tooltip"]')).toBeNull()
    rerender(<Tip open />)
    expect(document.body.querySelector('[data-component="tooltip"]')?.textContent).toContain(
      "The tip text",
    )
    rerender(<Tip open={false} />)
    expect(document.body.querySelector('[data-component="tooltip"]')).toBeNull()
  })

  it("renders title and keybind in TooltipKeybind", () => {
    renderUI(
      <TooltipProvider>
        <Tooltip open>
          <TooltipTrigger>Save button</TooltipTrigger>
          <TooltipKeybind title="Save" keybind="Mod+S" />
        </Tooltip>
      </TooltipProvider>,
    )
    const tip = document.body.querySelector('[data-component="tooltip"]')
    expect(tip?.textContent).toContain("Save")
    expect(tip?.querySelector('[data-slot="tooltip-keybind-key"]')?.textContent).toBe("Mod+S")
  })
})
