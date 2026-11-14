// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * MentionTextarea IME tests (cc-switch ime-safe-input borrowing): the
 * textarea sits on the shared ImeSafeTextarea, so @-token detection runs
 * on COMMITTED text only — during an IME composition the popup stays
 * shut, the parent sees no onChange, Enter belongs to the IME (never
 * submits), and the end-of-composition commit re-runs detection exactly
 * once over the composed text.
 */
import { describe, it, expect, afterEach, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import { getDictionary, registerLocale, setLocale } from "@max/i18n"

import enDomain from "../src/locales/mentions.en-US.json"
import zhDomain from "../src/locales/mentions.zh-CN.json"
import { createRolesProvider, type MentionProvider } from "../src/components/mentions/model"
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

/** Render a stateful MentionTextarea and hand back the committed-value log. */
function setup(providers: MentionProvider[], onSubmit?: () => void) {
  const committed: string[] = []
  function Bound() {
    const [value, setValue] = useState("")
    return (
      <MentionTextarea
        value={value}
        onChange={(next) => {
          committed.push(next)
          setValue(next)
        }}
        providers={providers}
        onSubmit={onSubmit}
      />
    )
  }
  render(<Bound />)
  const input = screen.getByTestId("mention-input") as HTMLTextAreaElement
  /** A committed keystroke (plain typing, no IME). */
  const type = (text: string) => {
    act(() => {
      fireEvent.change(input, {
        target: { value: text, selectionStart: text.length, selectionEnd: text.length },
      })
    })
  }
  const compose = (marked: string[], final: string) => {
    act(() => {
      fireEvent.compositionStart(input)
      for (const mid of marked) {
        fireEvent.change(input, {
          target: { value: mid, selectionStart: mid.length, selectionEnd: mid.length },
        })
      }
      // The engine lands the final text in the element before compositionend.
      fireEvent.change(input, {
        target: { value: final, selectionStart: final.length, selectionEnd: final.length },
      })
      fireEvent.compositionEnd(input)
    })
  }
  return { committed, input, type, compose }
}

describe("MentionTextarea composition gating", () => {
  const providers: MentionProvider[] = [
    createRolesProvider((key) => en[key as keyof typeof en] as string),
  ]

  it("keeps the popup shut and the parent uncommitted during a composition", () => {
    const { committed, input, type, compose } = setup(providers)
    type("@re")
    // Committed typing opens the popup as usual.
    expect(screen.getByTestId("mention-popup")).toBeInTheDocument()

    // Composition starts: the completion state parks (popup closed) and
    // the marked text never reaches the parent.
    act(() => {
      fireEvent.compositionStart(input)
    })
    expect(screen.queryByTestId("mention-popup")).not.toBeInTheDocument()
    act(() => {
      fireEvent.change(input, {
        target: { value: "@re你好", selectionStart: 5, selectionEnd: 5 },
      })
      // IME keyups (keyCode 229) must not re-open detection either.
      fireEvent.keyUp(input, { target: { value: "@re你好", selectionStart: 5 } })
    })
    expect(screen.queryByTestId("mention-popup")).not.toBeInTheDocument()
    // Only the pre-composition committed typing is in the log.
    expect(committed).toEqual(["@re"])

    compose([], "@re你好")
    // One commit, exactly at composition end — token detection over the
    // composed text finds no [a-z] token, so the popup stays shut.
    expect(committed).toEqual(["@re", "@re你好"])
    expect(input.value).toBe("@re你好")
    expect(screen.queryByTestId("mention-popup")).not.toBeInTheDocument()
  })

  it("commits once at composition end and re-runs token detection", () => {
    const { committed, input, compose } = setup(providers)
    compose(["@sh"], "@shin")
    expect(committed).toEqual(["@shin"])
    // Detection resumed over the committed text: "shin" prefixes no role,
    // but a committed ASCII token opens the popup again.
    act(() => {
      fireEvent.change(input, {
        target: { value: "@review", selectionStart: 7, selectionEnd: 7 },
      })
    })
    expect(screen.getByTestId("mention-popup")).toBeInTheDocument()
    const tokens = screen.getAllByTestId("mention-option").map((o) => o.textContent)
    expect(tokens.join("|")).toContain("reviewer")
  })

  it("Enter during a composition belongs to the IME and never submits", () => {
    const onSubmit = vi.fn()
    const { input, compose } = setup(providers, onSubmit)
    act(() => {
      fireEvent.compositionStart(input)
      fireEvent.keyDown(input, { key: "Enter" })
    })
    expect(onSubmit).not.toHaveBeenCalled()
    compose([], "")
    act(() => {
      fireEvent.keyDown(input, { key: "Enter" })
    })
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })
})
