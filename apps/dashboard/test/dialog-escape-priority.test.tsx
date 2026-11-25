// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Dialog Escape priority tests. A combobox that is expanded when Escape is
 * pressed consumes that press itself (closing its listbox); the dialog must
 * stay open so unsaved input survives, and only the next Escape closes it.
 * Also covers a Radix Select inside the dialog and a custom popover that
 * shields Escape with stopPropagation.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from "react"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../src/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../src/components/ui/select"

// jsdom lacks the pointer-capture / scroll APIs Radix Select calls.
beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.setPointerCapture = () => {}
  Element.prototype.releasePointerCapture = () => {}
  Element.prototype.scrollIntoView = () => {}
})

afterEach(() => {
  cleanup()
})

/** React-Aria-shaped combobox: focus stays on the input; Escape collapses it. */
function ComboboxDialog() {
  const [open, setOpen] = useState(true)
  const [expanded, setExpanded] = useState(true)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent data-testid="dialog">
        <DialogHeader>
          <DialogTitle>Combobox dialog</DialogTitle>
        </DialogHeader>
        <input
          role="combobox"
          aria-label="provider"
          aria-expanded={expanded}
          onKeyDown={(event) => {
            if (event.key === "Escape") setExpanded(false)
          }}
        />
      </DialogContent>
    </Dialog>
  )
}

function SelectDialog() {
  const [open, setOpen] = useState(true)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent data-testid="dialog">
        <DialogHeader>
          <DialogTitle>Select dialog</DialogTitle>
        </DialogHeader>
        <Select>
          <SelectTrigger aria-label="pick">
            <SelectValue placeholder="choose" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="a">Alpha</SelectItem>
            <SelectItem value="b">Beta</SelectItem>
          </SelectContent>
        </Select>
      </DialogContent>
    </Dialog>
  )
}

/** A custom popover that shields Escape while it is open (capture phase). */
function ShieldingPopoverDialog({ shield }: { shield: boolean }) {
  const [open, setOpen] = useState(true)
  useEffect(() => {
    if (!shield) return undefined
    const stop = (event: KeyboardEvent) => {
      if (event.key === "Escape") event.stopPropagation()
    }
    window.addEventListener("keydown", stop, true)
    return () => window.removeEventListener("keydown", stop, true)
  }, [shield])
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent data-testid="dialog">
        <DialogHeader>
          <DialogTitle>Shielded dialog</DialogTitle>
        </DialogHeader>
        <input aria-label="popover search" />
      </DialogContent>
    </Dialog>
  )
}

describe("dialog Escape priority over an expanded combobox", () => {
  it("keeps the dialog open on the first Escape and closes it on the second", async () => {
    const user = userEvent.setup()
    render(<ComboboxDialog />)
    const combobox = screen.getByRole("combobox", { name: "provider" })
    combobox.focus()

    await user.keyboard("{Escape}")

    expect(screen.getByTestId("dialog")).toBeInTheDocument()
    expect(combobox).toHaveAttribute("aria-expanded", "false")

    await user.keyboard("{Escape}")

    expect(screen.queryByTestId("dialog")).not.toBeInTheDocument()
  })

  it("lets an open Radix Select take the first Escape", async () => {
    const user = userEvent.setup()
    render(<SelectDialog />)

    await user.click(screen.getByRole("combobox", { name: "pick" }))
    expect(await screen.findByRole("listbox")).toBeInTheDocument()

    await user.keyboard("{Escape}")
    expect(screen.getByTestId("dialog")).toBeInTheDocument()
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument()

    await user.keyboard("{Escape}")
    expect(screen.queryByTestId("dialog")).not.toBeInTheDocument()
  })

  it("still lets a custom popover that stops Escape propagation shield the dialog", async () => {
    const user = userEvent.setup()
    const { rerender } = render(<ShieldingPopoverDialog shield />)

    await user.keyboard("{Escape}")
    expect(screen.getByTestId("dialog")).toBeInTheDocument()

    rerender(<ShieldingPopoverDialog shield={false} />)
    await user.keyboard("{Escape}")
    expect(screen.queryByTestId("dialog")).not.toBeInTheDocument()
  })

  it("composes with a consumer onEscapeKeyDown handler", async () => {
    const user = userEvent.setup()
    const onEscapeKeyDown = vi.fn((event: ReactKeyboardEvent) => event.preventDefault())

    function GuardedDialog() {
      const [open, setOpen] = useState(true)
      return (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent data-testid="dialog" onEscapeKeyDown={onEscapeKeyDown}>
            <DialogHeader>
              <DialogTitle>Guarded dialog</DialogTitle>
            </DialogHeader>
          </DialogContent>
        </Dialog>
      )
    }

    render(<GuardedDialog />)

    await user.keyboard("{Escape}")

    expect(onEscapeKeyDown).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId("dialog")).toBeInTheDocument()
  })
})
