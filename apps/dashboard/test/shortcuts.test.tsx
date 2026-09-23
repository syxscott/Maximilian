// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Shortcuts tests — the recorder hook state machine and the
 * ShortcutsSection catalog (record flow, localStorage persistence,
 * conflict warning, resets).
 */
import { describe, it, expect, afterEach, vi } from "vitest"
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react"
import { getDictionary, registerLocale, setLocale } from "@max/i18n"

import enDomain from "../src/locales/shortcuts.en-US.json"
import zhDomain from "../src/locales/shortcuts.zh-CN.json"
import { useShortcutRecorder } from "../src/components/shortcuts/useShortcutRecorder"
import { ShortcutsSection } from "../src/components/shortcuts/ShortcutsSection"
import { COMMANDS } from "../src/lib/commands"
import { SHORTCUT_OVERRIDES_KEY, readOverrides, type StorageLike } from "../src/lib/keybinds"

const en = { ...(getDictionary("en-US") ?? {}), ...(enDomain as Record<string, string>) }
const zh = { ...(getDictionary("zh-CN") ?? {}), ...(zhDomain as Record<string, string>) }
registerLocale("en-US", en)
registerLocale("zh-CN", zh)
setLocale("en-US")

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  setLocale("en-US")
})

/** Fresh in-memory storage double per test. */
function memoryStorage(): StorageLike {
  const backing = new Map<string, string>()
  return {
    getItem: (k) => backing.get(k) ?? null,
    setItem: (k, v) => void backing.set(k, v),
  }
}

describe("useShortcutRecorder", () => {
  const keyDown = (init: KeyboardEventInit) =>
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", init))
    })

  it("captures the next combo and disarms", () => {
    const onCapture = vi.fn()
    const { result } = renderHook(() => useShortcutRecorder({ onCapture }))
    expect(result.current.recording).toBe(false)
    act(() => result.current.start())
    expect(result.current.recording).toBe(true)
    keyDown({ key: "j", ctrlKey: true })
    expect(onCapture).toHaveBeenCalledWith({ mod: true, key: "j" })
    expect(result.current.recording).toBe(false)
  })

  it("cancels on Escape without emitting", () => {
    const onCapture = vi.fn()
    const onCancel = vi.fn()
    const { result } = renderHook(() => useShortcutRecorder({ onCapture, onCancel }))
    act(() => result.current.start())
    keyDown({ key: "Escape" })
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onCapture).not.toHaveBeenCalled()
    expect(result.current.recording).toBe(false)
  })

  it("keeps waiting on bare modifiers and unmodified letters", () => {
    const onCapture = vi.fn()
    const { result } = renderHook(() => useShortcutRecorder({ onCapture }))
    act(() => result.current.start())
    keyDown({ key: "Shift", shiftKey: true })
    keyDown({ key: "a" })
    expect(onCapture).not.toHaveBeenCalled()
    expect(result.current.recording).toBe(true)
    keyDown({ key: "F2" })
    expect(onCapture).toHaveBeenCalledWith({ key: "F2" })
  })

  it("cancel() disarms without invoking callbacks", () => {
    const onCancel = vi.fn()
    const { result } = renderHook(() => useShortcutRecorder({ onCancel }))
    act(() => result.current.start())
    act(() => result.current.cancel())
    expect(result.current.recording).toBe(false)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it("does nothing while idle", () => {
    const onCapture = vi.fn()
    renderHook(() => useShortcutRecorder({ onCapture }))
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }))
    expect(onCapture).not.toHaveBeenCalled()
  })
})

describe("ShortcutsSection", () => {
  const row = (id: string) =>
    Array.from(document.querySelectorAll('[data-testid="shortcuts-row"]')).find(
      (el) => el.getAttribute("data-command-id") === id,
    )

  const recordButton = (id: string) => {
    const el = row(id)
    if (!el) throw new Error(`row ${id} not found`)
    return el.querySelector('[data-testid="shortcuts-record"]') as HTMLElement
  }

  it("lists every command with formatted default bindings", () => {
    render(<ShortcutsSection storage={memoryStorage()} />)
    const rows = document.querySelectorAll('[data-testid="shortcuts-row"]')
    expect(rows).toHaveLength(COMMANDS.length)
    // nav.workspace defaults to Ctrl+1 (non-mac formatting).
    expect(recordButton("nav.workspace").textContent).toBe("Ctrl+1")
    expect(recordButton("view.toggleSidebar").textContent).toBe("Ctrl+Shift+B")
    expect(screen.getByText(enDomain["shortcuts.title"])).toBeInTheDocument()
  })

  it("records a combo and persists it to storage", () => {
    const storage = memoryStorage()
    render(<ShortcutsSection storage={storage} />)
    fireEvent.click(recordButton("nav.workspace"))
    expect(recordButton("nav.workspace").textContent).toContain("Press a key combo")
    fireEvent.keyDown(window, { key: "j", ctrlKey: true })
    expect(recordButton("nav.workspace").textContent).toBe("Ctrl+J")
    expect(readOverrides(storage)["nav.workspace"]).toEqual({ mod: true, key: "j" })
    expect(screen.getByTestId("shortcuts-row-notice")).toHaveTextContent("Recorded Ctrl+J")
  })

  it("warns when the recording conflicts with another command", () => {
    const storage = memoryStorage()
    render(<ShortcutsSection storage={storage} />)
    // Ctrl+2 is nav.executions' default — recording it for nav.workspace
    // must flag the collision.
    fireEvent.click(recordButton("nav.workspace"))
    fireEvent.keyDown(window, { key: "2", ctrlKey: true })
    expect(screen.getByTestId("shortcuts-row-notice")).toHaveTextContent("Conflicts with")
  })

  it("cancels a recording with Escape", () => {
    render(<ShortcutsSection storage={memoryStorage()} />)
    fireEvent.click(recordButton("action.stopStream"))
    fireEvent.keyDown(window, { key: "Escape" })
    // stopStream has no default binding — the idle button offers recording.
    expect(recordButton("action.stopStream").textContent).toBe("Click to record")
    expect(screen.getByTestId("shortcuts-row-notice")).toHaveTextContent("Recording cancelled")
  })

  it("resets a single override and honours stored overrides on mount", () => {
    const storage = memoryStorage()
    storage.setItem(
      SHORTCUT_OVERRIDES_KEY,
      JSON.stringify({ "nav.usage": { mod: true, key: "9" } }),
    )
    render(<ShortcutsSection storage={storage} />)
    expect(recordButton("nav.usage").textContent).toBe("Ctrl+9")
    fireEvent.click(screen.getByTestId("shortcuts-reset-all"))
    expect(recordButton("nav.usage").textContent).toBe("Ctrl+5")
    expect(readOverrides(storage)).toEqual({})
  })

  it("persists through the real window.localStorage", () => {
    render(<ShortcutsSection />)
    fireEvent.click(recordButton("nav.settings"))
    fireEvent.keyDown(window, { key: "0", ctrlKey: true })
    const stored = JSON.parse(window.localStorage.getItem(SHORTCUT_OVERRIDES_KEY) ?? "{}")
    expect(stored["nav.settings"]).toEqual({ mod: true, key: "0" })
  })
})
