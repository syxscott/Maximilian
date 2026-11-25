// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * useModalFocus contract tests: initial focus (and respect for content
 * autoFocus), Tab wrapping, focus that escapes being pulled back, a named
 * radio group counting as one Tab stop, portaled popovers keeping focus,
 * opener restoration on close, and nested overlays where only the topmost
 * owns focus.
 */
import { afterEach, describe, expect, it } from "vitest"
import { StrictMode, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { useModalFocus } from "../src/hooks/use-modal-focus"
import { cleanup, click, focus, keyDown, renderUI } from "./helpers"

function Overlay({ children }: { children: ReactNode }) {
  const modal = useModalFocus<HTMLDivElement>()
  return (
    <div
      ref={modal.rootRef}
      role="dialog"
      tabIndex={-1}
      onFocus={modal.onFocus}
      onKeyDown={modal.onKeyDown}
    >
      {children}
    </div>
  )
}

function OpenCloseHarness({ children }: { children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        opener
      </button>
      {open ? <Overlay>{children(() => setOpen(false))}</Overlay> : null}
    </>
  )
}

const buttons = (container: HTMLElement) => ({
  opener: container.querySelector('button[type="button"]') as HTMLButtonElement,
  first: container.querySelectorAll('button[type="button"]')[1] as HTMLButtonElement,
  last: container.querySelectorAll('button[type="button"]')[2] as HTMLButtonElement,
})

describe("useModalFocus", () => {
  it("moves focus to the first tabbable control when it opens", () => {
    const view = renderUI(
      <OpenCloseHarness>
        {(close) => (
          <>
            <button type="button" onClick={close}>
              first
            </button>
            <button type="button">last</button>
          </>
        )}
      </OpenCloseHarness>,
    )
    const { opener } = buttons(view.container)
    focus(opener)
    click(opener)

    expect(document.activeElement).toBe(buttons(view.container).first)
  })

  it("leaves focus alone when the content already focused itself", () => {
    const view = renderUI(
      <OpenCloseHarness>
        {() => (
          <>
            <button type="button">first</button>
            <input aria-label="name" autoFocus />
          </>
        )}
      </OpenCloseHarness>,
    )
    const { opener } = buttons(view.container)
    focus(opener)
    click(opener)

    expect(document.activeElement).toBe(view.container.querySelector('input[aria-label="name"]'))
  })

  it("wraps Tab and Shift+Tab inside the overlay", () => {
    const view = renderUI(
      <OpenCloseHarness>
        {() => (
          <>
            <button type="button">first</button>
            <button type="button">last</button>
          </>
        )}
      </OpenCloseHarness>,
    )
    const { opener } = buttons(view.container)
    focus(opener)
    click(opener)
    const { first, last } = buttons(view.container)

    focus(last)
    keyDown(last, "Tab")
    expect(document.activeElement).toBe(first)

    keyDown(first, "Tab", { shiftKey: true })
    expect(document.activeElement).toBe(last)
  })

  it("pulls focus back when an element outside the overlay takes it", () => {
    const view = renderUI(
      <OpenCloseHarness>
        {() => (
          <>
            <button type="button">first</button>
            <button type="button">last</button>
          </>
        )}
      </OpenCloseHarness>,
    )
    const { opener } = buttons(view.container)
    focus(opener)
    click(opener)
    const { first } = buttons(view.container)
    expect(document.activeElement).toBe(first)

    focus(opener)
    expect(document.activeElement).toBe(first)
  })

  it("collapses a named radio group to a single Tab stop", () => {
    const view = renderUI(
      <OpenCloseHarness>
        {() => (
          <>
            <input type="radio" name="group" aria-label="a1" />
            <input type="radio" name="group" aria-label="a2" defaultChecked />
            <input type="radio" name="other" aria-label="b1" />
            <button type="button">after</button>
          </>
        )}
      </OpenCloseHarness>,
    )
    const { opener } = buttons(view.container)
    focus(opener)
    click(opener)
    const a2 = view.container.querySelector('input[aria-label="a2"]') as HTMLInputElement
    const trailing = Array.from(view.container.querySelectorAll("button")).find(
      (el) => el.textContent === "after",
    ) as HTMLButtonElement

    // Mount lands on the checked radio, not the first of the group.
    expect(document.activeElement).toBe(a2)

    // Tab wrapping from the trailing control lands on the group's single
    // stop — without collapsing, this would be the unchecked first radio.
    focus(trailing)
    keyDown(trailing, "Tab")
    expect(document.activeElement).toBe(a2)
  })

  it("ignores StrictMode's simulated unmount and keeps the content's own focus", () => {
    const view = renderUI(
      <StrictMode>
        <OpenCloseHarness>
          {() => (
            <>
              <button type="button">first</button>
              <input aria-label="name" autoFocus />
            </>
          )}
        </OpenCloseHarness>
      </StrictMode>,
    )
    const { opener } = buttons(view.container)
    focus(opener)
    click(opener)

    expect(document.activeElement).toBe(view.container.querySelector('input[aria-label="name"]'))
  })

  it("lets a popover portaled outside the root keep focus", () => {
    const view = renderUI(
      <Overlay>
        <button type="button">first</button>
        {createPortal(<input aria-label="popover search" />, document.body)}
      </Overlay>,
    )
    const popover = document.querySelector('input[aria-label="popover search"]') as HTMLInputElement

    focus(popover)

    expect(document.activeElement).toBe(popover)
    expect(view.container.contains(popover)).toBe(false)
  })

  it("restores focus to the opener when the overlay closes", () => {
    const view = renderUI(
      <OpenCloseHarness>
        {(close) => (
          <button type="button" onClick={close}>
            close
          </button>
        )}
      </OpenCloseHarness>,
    )
    const opener = view.container.querySelector('button[type="button"]') as HTMLButtonElement
    focus(opener)
    click(opener)
    const close = view.container.querySelectorAll('button[type="button"]')[1] as HTMLButtonElement
    click(close)

    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(opener)
  })

  it("gives focus to the topmost of nested overlays and hands it back on close", () => {
    function Nested() {
      const [outerOpen, setOuterOpen] = useState(false)
      const [innerOpen, setInnerOpen] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setOuterOpen(true)}>
            opener
          </button>
          {outerOpen ? (
            <Overlay>
              <button type="button" onClick={() => setInnerOpen(true)}>
                open inner
              </button>
              {innerOpen ? (
                <Overlay>
                  <button type="button" onClick={() => setInnerOpen(false)}>
                    close inner
                  </button>
                </Overlay>
              ) : null}
            </Overlay>
          ) : null}
        </>
      )
    }

    const view = renderUI(<Nested />)
    const all = () => Array.from(view.container.querySelectorAll('button[type="button"]'))
    const opener = all()[0] as HTMLButtonElement

    focus(opener)
    click(opener)
    const openInner = all()[1] as HTMLButtonElement
    expect(document.activeElement).toBe(openInner)

    focus(openInner)
    click(openInner)
    const closeInner = all()[2] as HTMLButtonElement
    expect(document.activeElement).toBe(closeInner)

    click(closeInner)
    expect(document.activeElement).toBe(openInner)
  })
})

afterEach(() => {
  cleanup()
})
