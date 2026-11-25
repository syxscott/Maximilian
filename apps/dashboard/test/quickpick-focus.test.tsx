// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * QuickPick focus contract integration tests. QuickPick is a hand-rolled
 * overlay (no Radix Dialog/Select underneath), so it borrows the shared
 * useModalFocus contract: opening moves focus into the query box, Tab
 * cycles inside instead of escaping into the page, an outside element
 * taking focus is pulled back, and closing returns focus to the opener.
 */
import { afterEach, describe, expect, it } from "vitest"
import { useState } from "react"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { getDictionary, registerLocale, setLocale } from "@max/i18n"

import enDomain from "../src/locales/quickpick.en-US.json"
import { QuickPick } from "../src/components/quickpick/QuickPick"
import type { QuickPickItem } from "../src/components/quickpick/model"

registerLocale("en-US", {
  ...(getDictionary("en-US") ?? {}),
  ...(enDomain as Record<string, string>),
})
setLocale("en-US")

const items: QuickPickItem[] = [
  { id: "alpha", label: "Alpha" },
  { id: "beta", label: "Beta" },
  { id: "gamma", label: "Gamma" },
]

function Harness() {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        open picker
      </button>
      <QuickPick open={open} onOpenChange={setOpen} items={items} />
      <button type="button">outside</button>
    </div>
  )
}

afterEach(() => {
  cleanup()
  setLocale("en-US")
})

describe("QuickPick focus contract", () => {
  it("moves focus into the query box when it opens", async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(screen.getByRole("button", { name: "open picker" }))

    expect(screen.getByTestId("quickpick-input")).toHaveFocus()
  })

  it("wraps Tab and Shift+Tab inside the picker", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole("button", { name: "open picker" }))
    const input = screen.getByTestId("quickpick-input")
    const options = screen.getAllByTestId("quickpick-item")

    await user.tab()
    expect(options[0]).toHaveFocus()
    await user.tab()
    expect(options[1]).toHaveFocus()
    await user.tab()
    expect(options[2]).toHaveFocus()

    // Past the last option the picker wraps back to the query box.
    await user.tab()
    expect(input).toHaveFocus()

    // Shift+Tab from the first stop wraps to the last option.
    await user.tab({ shift: true })
    expect(options[2]).toHaveFocus()
  })

  it("pulls focus back when an element outside the picker takes it", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole("button", { name: "open picker" }))
    const input = screen.getByTestId("quickpick-input")

    await user.click(screen.getByRole("button", { name: "outside" }))

    expect(input).toHaveFocus()
  })

  it("returns focus to the opener when it closes", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const opener = screen.getByRole("button", { name: "open picker" })
    await user.click(opener)

    await user.keyboard("{Escape}")

    expect(screen.queryByTestId("quickpick")).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })
})
