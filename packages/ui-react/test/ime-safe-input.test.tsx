// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * ImeSafeInput / ImeSafeTextarea tests (cc-switch ime-safe-input
 * borrowing): composition-period gating (marked text stays local, the
 * parent sees nothing), exactly-once commit on compositionend, the
 * WebKit blur-without-compositionend catch-up commit, suppression of the
 * duplicate `input` some engines fire after compositionend, and the
 * composing-state notifications.
 *
 * Native event recipe (no testing-library in this package): the value is
 * written through the prototype's own setter so React's value tracker
 * registers a change, then a bubbling `input` event drives onChange;
 * blur is dispatched as bubbling `focusout` (React's onBlur channel).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, useState } from "react"
import { ImeSafeInput, ImeSafeTextarea } from "../src/index.js"
import { cleanup, dispatch, renderUI } from "./helpers.js"

/** React-visible value write + input event (fires the controlled onChange). */
function typeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement
  const setter = Object.getOwnPropertyDescriptor(proto.prototype, "value")?.set
  if (!setter) throw new Error("no value setter")
  setter.call(el, value)
  act(() => {
    el.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

function composition(
  target: EventTarget,
  type: "compositionstart" | "compositionupdate" | "compositionend",
  data = "",
) {
  dispatch(target, new CompositionEvent(type, { bubbles: true, data }))
}

function blur(target: EventTarget) {
  dispatch(target, new FocusEvent("focusout", { bubbles: true }))
}

/** Stateful harness: mirrors the committed value back into the prop. */
function ValueHarness(props: {
  committed: string[]
  multiline?: boolean
  composing?: (composing: boolean) => void
  initial?: string
}) {
  const [value, setValue] = useState(props.initial ?? "")
  const onValueChange = (next: string) => {
    props.committed.push(next)
    setValue(next)
  }
  const common = {
    value,
    onValueChange,
    onComposingChange: props.composing,
    "data-testid": "ime-field",
  }
  return props.multiline ? <ImeSafeTextarea {...common} /> : <ImeSafeInput {...common} />
}

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(performance.now())
    return 0
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
})

describe("ImeSafeInput", () => {
  const field = () => document.querySelector<HTMLInputElement>('[data-testid="ime-field"]')!

  it("commits ordinary (non-composition) edits per keystroke", () => {
    const committed: string[] = []
    renderUI(<ValueHarness committed={committed} />)
    typeValue(field(), "h")
    typeValue(field(), "he")
    expect(committed).toEqual(["h", "he"])
    expect(field().value).toBe("he")
  })

  it("holds the marked text locally during a composition and commits once at the end", () => {
    const committed: string[] = []
    renderUI(<ValueHarness committed={committed} />)
    const el = field()

    composition(el, "compositionstart")
    typeValue(el, "ni") // pinyin marked text arrives as input events
    typeValue(el, "nihao")
    expect(committed).toEqual([])
    // The element still shows the live marked text.
    expect(el.value).toBe("nihao")

    // The engine lands the final text in the element (still composing),
    // and only compositionend reports it to the parent.
    typeValue(el, "你好")
    expect(committed).toEqual([])

    composition(el, "compositionend", "你好")
    expect(committed).toEqual(["你好"])
    expect(el.value).toBe("你好")
  })

  it("updates the display on composition updates (not only at the end)", () => {
    const committed: string[] = []
    renderUI(<ValueHarness committed={committed} />)
    const el = field()
    composition(el, "compositionstart")
    typeValue(el, "ni")
    composition(el, "compositionupdate", "你")
    typeValue(el, "你") // engine replaced the marked text mid-composition
    expect(el.value).toBe("你")
    expect(committed).toEqual([])
    typeValue(el, "你好") // the composition's final text lands before end
    composition(el, "compositionend", "你好")
    expect(committed).toEqual(["你好"])
  })

  it("suppresses the duplicate input event engines fire after compositionend", () => {
    const committed: string[] = []
    renderUI(<ValueHarness committed={committed} />)
    const el = field()
    composition(el, "compositionstart")
    typeValue(el, "ni")
    typeValue(el, "你") // final text lands in the element before end
    composition(el, "compositionend", "你")
    expect(committed).toEqual(["你"])

    // Engine echo: the same value reported again right after the commit.
    typeValue(el, "你")
    expect(committed).toEqual(["你"])

    // A genuinely new value still goes through.
    typeValue(el, "你!")
    expect(committed).toEqual(["你", "你!"])
  })

  it("does not commit a cancelled composition (value reverted before end)", () => {
    const committed: string[] = []
    renderUI(<ValueHarness committed={committed} />)
    const el = field()
    composition(el, "compositionstart")
    typeValue(el, "ni")
    // IME cancel: marked text reverts to the pre-composition value.
    typeValue(el, "")
    composition(el, "compositionend")
    expect(committed).toEqual([])
    // Ordinary typing works again afterwards.
    typeValue(el, "a")
    expect(committed).toEqual(["a"])
  })

  it("commits on blur when WebKit drops the compositionend (window switch)", () => {
    const committed: string[] = []
    renderUI(<ValueHarness committed={committed} />)
    const el = field()
    composition(el, "compositionstart")
    typeValue(el, "w")
    blur(el)
    expect(committed).toEqual(["w"])
    // Composition state retired — the next edit is an ordinary commit.
    typeValue(el, "wi")
    expect(committed).toEqual(["w", "wi"])
  })

  it("notifies onComposingChange at composition start and end", () => {
    const committed: string[] = []
    const composing: boolean[] = []
    renderUI(<ValueHarness committed={committed} composing={(c) => composing.push(c)} />)
    const el = field()
    composition(el, "compositionstart")
    typeValue(el, "ni")
    composition(el, "compositionend", "你")
    expect(composing).toEqual([true, false])
  })
})

describe("ImeSafeTextarea", () => {
  const field = () => document.querySelector<HTMLTextAreaElement>('[data-testid="ime-field"]')!

  it("gates the composition period and commits once at the end", () => {
    const committed: string[] = []
    renderUI(<ValueHarness committed={committed} multiline />)
    const el = field()
    composition(el, "compositionstart")
    typeValue(el, "zhongwen")
    expect(committed).toEqual([])
    expect(el.value).toBe("zhongwen")
    typeValue(el, "中文") // final text lands in the element before end
    expect(committed).toEqual([])
    composition(el, "compositionend", "中文")
    expect(committed).toEqual(["中文"])
    expect(el.value).toBe("中文")
  })

  it("commits the leftover marked text on blur without compositionend", () => {
    const committed: string[] = []
    renderUI(<ValueHarness committed={committed} multiline />)
    const el = field()
    composition(el, "compositionstart")
    typeValue(el, "zh")
    blur(el)
    expect(committed).toEqual(["zh"])
    expect(el.value).toBe("zh")
  })
})
