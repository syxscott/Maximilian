// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Trigger-detection URL-exception tests (deepseek-harness
 * ui-input-trigger detect.ts borrowing): the "/" trigger is
 * boundary-gated — line start, whitespace or punctuation — and the two
 * URL shapes stay inert everywhere (the second slash of a "//" pair, and
 * the slash that completes a scheme colon), so typing an address like
 * "https://x/y" or "a//b" never pops a completion layer.
 */
import { describe, it, expect, afterEach } from "vitest"
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react"
import { useState } from "react"
import { getDictionary, registerLocale, setLocale } from "@max/i18n"

import enDomain from "../src/locales/prompt-editor.en-US.json"
import zhDomain from "../src/locales/prompt-editor.zh-CN.json"
import { activeTrigger, type MentionProvider } from "../src/components/mentions/model"
import { parseSlashQuery } from "../src/components/prompt-editor/model"
import { useSlashCommands } from "../src/components/prompt-editor/useSlashCommands"
import { MentionTextarea } from "../src/components/mentions/MentionTextarea"

const en = { ...(getDictionary("en-US") ?? {}), ...(enDomain as Record<string, string>) }
const zh = { ...(getDictionary("zh-CN") ?? {}), ...(zhDomain as Record<string, string>) }
registerLocale("en-US", en)
registerLocale("zh-CN", zh)
setLocale("en-US")

afterEach(() => {
  cleanup()
  setLocale("en-US")
})

describe("slashTriggerOpen via activeTrigger", () => {
  const slash = ["/"]

  it("opens at line start, whitespace and punctuation boundaries", () => {
    expect(activeTrigger("/", 1, slash)).toEqual({ trigger: "/", token: "" })
    expect(activeTrigger(" /nav", 5, slash)).toEqual({ trigger: "/", token: "nav" })
    expect(activeTrigger("(/nav", 5, slash)).toEqual({ trigger: "/", token: "nav" })
  })

  it("never opens mid-word or inside URLs", () => {
    expect(activeTrigger("a/b", 3, slash)).toBeNull()
    // The scheme-completing slash of "https:/".
    expect(activeTrigger("https:/", 7, slash)).toBeNull()
    // The second slash of the "//" pair.
    expect(activeTrigger("https://", 8, slash)).toBeNull()
    // The path slash and token of a full URL.
    expect(activeTrigger("https://x/y", 11, slash)).toBeNull()
    // The "a//b" double slash.
    expect(activeTrigger("a//b", 4, slash)).toBeNull()
  })

  it("does not gate the other triggers", () => {
    expect(activeTrigger("hey@pl", 6, ["@"])).toEqual({ trigger: "@", token: "pl" })
    expect(activeTrigger("see #mai", 8, ["#"])).toEqual({ trigger: "#", token: "mai" })
  })
})

describe("parseSlashQuery URL exceptions", () => {
  /** Every caret position inside `text` must yield null. */
  const expectInert = (text: string) => {
    for (let caret = 0; caret <= text.length; caret++) {
      expect(parseSlashQuery(text, caret), `${text} @${caret}`).toBeNull()
    }
  }

  it("keeps a full URL inert at every caret", () => {
    expectInert("https://x/y")
  })

  it("keeps a double-slash body inert at every caret", () => {
    expectInert("a//b")
  })

  it("still opens on committed boundary slashes", () => {
    expect(parseSlashQuery("/", 1)).toBe("")
    expect(parseSlashQuery("/nav", 4)).toBe("nav")
    expect(parseSlashQuery("hello /nav", 10)).toBe("nav")
    expect(parseSlashQuery("(/cmd", 5)).toBe("cmd")
    // Whitespace already closed the token.
    expect(parseSlashQuery("/nav workspace", 14)).toBeNull()
  })
})

describe("useSlashCommands URL exceptions", () => {
  function renderCommands(text: string, caret = text.length) {
    const onSelect = () => {}
    const { result } = renderHook(() => useSlashCommands({ text, caret, onSelect }))
    return result.current
  }

  it("does not open while the caret moves through a URL", () => {
    const state = renderCommands("https://x/y")
    expect(state.query).toBeNull()
    expect(state.open).toBe(false)
  })

  it("does not open on a double-slash body", () => {
    const state = renderCommands("a//b")
    expect(state.query).toBeNull()
    expect(state.open).toBe(false)
  })

  it("opens mid-text after a whitespace boundary", () => {
    const state = renderCommands("run /na")
    expect(state.query).toBe("na")
    expect(state.open).toBe(true)
  })
})

describe("MentionTextarea with a slash provider", () => {
  const commands: MentionProvider = {
    id: "commands",
    triggers: ["/"],
    list: (token) =>
      ["nav", "usage"]
        .filter((t) => t.startsWith(token.toLowerCase()))
        .map((t) => ({ token: t, description: "command" })),
  }

  function Harness() {
    const [value, setValue] = useState("")
    return <MentionTextarea value={value} onChange={setValue} providers={[commands]} />
  }

  /** Type progressively, asserting after every keystroke. */
  const type = (input: HTMLElement, text: string) => {
    act(() => {
      fireEvent.change(input, {
        target: { value: text, selectionStart: text.length, selectionEnd: text.length },
      })
    })
  }

  it("typing a URL never pops the layer; a boundary slash does", () => {
    render(<Harness />)
    const input = screen.getByTestId("mention-input")
    for (const step of ["h", "https", "https:", "https:/", "https://", "https://x/y"]) {
      type(input, step)
      expect(screen.queryByTestId("mention-popup"), `step "${step}"`).not.toBeInTheDocument()
      expect(screen.queryByTestId("mention-empty"), `step "${step}"`).not.toBeInTheDocument()
    }
    type(input, "a//b")
    expect(screen.queryByTestId("mention-popup")).not.toBeInTheDocument()
    // A whitespace-bounded slash token opens the completion layer.
    type(input, "a//b /na")
    expect(screen.getByTestId("mention-popup")).toBeInTheDocument()
    expect(
      screen.getAllByTestId("mention-option").some((o) => o.textContent?.startsWith("/nav")),
    ).toBe(true)
  })
})
