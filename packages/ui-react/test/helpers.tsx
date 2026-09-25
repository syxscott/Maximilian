import * as React from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"

// Tell React 19 that this is an act()-driven environment.
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

// jsdom has no ResizeObserver; stub it so radix primitives (use-size etc.)
// and our own components can mount without feature detection.
if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  ;(globalThis as Record<string, unknown>).ResizeObserver = ResizeObserverStub
}

const roots: Root[] = []

export interface RenderResult {
  container: HTMLElement
  rerender: (ui: React.ReactNode) => void
  unmount: () => void
}

/**
 * Mount a React element with react-dom/client and return the container.
 * Portals render into document.body, same as in the app.
 */
export function renderUI(ui: React.ReactNode): RenderResult {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  act(() => {
    root.render(ui)
  })
  return {
    container,
    rerender(next: React.ReactNode) {
      act(() => {
        root.render(next)
      })
    },
    unmount() {
      act(() => {
        root.unmount()
      })
    },
  }
}

/** Unmount every root created by renderUI and reset the DOM. */
export function cleanup() {
  while (roots.length > 0) {
    const root = roots.pop()
    if (root) {
      act(() => {
        root.unmount()
      })
    }
  }
  document.body.innerHTML = ""
}

export function dispatch(target: EventTarget, event: Event) {
  act(() => {
    target.dispatchEvent(event)
  })
}

export function click(target: EventTarget) {
  dispatch(target, new MouseEvent("click", { bubbles: true, cancelable: true }))
}

export function mouseDown(target: EventTarget, init: MouseEventInit = {}) {
  dispatch(
    target,
    new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0, ...init }),
  )
}

/** Programmatic focus; wrapped in act because focus events update React state. */
export function focus(target: HTMLElement) {
  act(() => {
    target.focus()
  })
}

export function keyDown(target: EventTarget, key: string, init: KeyboardEventInit = {}) {
  dispatch(target, new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }))
}

/** Flush pending macrotasks (e.g. document-level listeners registered in timeouts). */
export async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

/** All elements whose full text equals `text`, reduced to the innermost ones. */
export function queryByText(root: ParentNode, text: string): HTMLElement | null {
  const all = Array.from(root.querySelectorAll<HTMLElement>("*")).filter(
    (el) => (el.textContent ?? "").trim() === text,
  )
  return all.find((el) => !all.some((other) => other !== el && el.contains(other))) ?? null
}

export function getByText(root: ParentNode, text: string): HTMLElement {
  const el = queryByText(root, text)
  if (!el) throw new Error(`No element with text "${text}" found`)
  return el
}
