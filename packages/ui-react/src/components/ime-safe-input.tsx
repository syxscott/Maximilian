// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * ImeSafeInput / ImeSafeTextarea — controlled single-line and multiline
 * text inputs whose value contract is composition-safe (cc-switch
 * ime-safe-input borrowing).
 *
 * The dashboard is a zh-CN product: an IME composition (pinyin → hanzi)
 * fires a stream of `input` events while the marked text is still being
 * edited, and a naive controlled input reports every one of them to the
 * parent. Consumers that parse the value per keystroke (@-mention and
 * `/`-command trigger detection) would run against half-composed pinyin.
 *
 * The mechanism, ported from cc-switch's ime-safe-input:
 *   - `compositionstart` → `compositionend`: the marked text stays in a
 *     component-local draft; the parent's `onValueChange` is not called.
 *   - `compositionend` commits the composed value exactly once.
 *   - WebKit quirk: switching windows can end a composition without
 *     firing `compositionend` — `blur` commits whatever marked text
 *     remains, so nothing is silently dropped.
 *   - Some engines fire a trailing `input` right after `compositionend`
 *     with the already-committed value; `externalValueRef` suppresses
 *     that duplicate report.
 */

import {
  useRef,
  useState,
  type CompositionEvent,
  type ComponentPropsWithRef,
  type FocusEvent,
  type FormEvent,
} from "react"

/** Elements this module's components render. */
type ImeSafeElement = HTMLInputElement | HTMLTextAreaElement

interface ImeSafeValueOptions {
  /** The authoritative committed value from the parent. */
  value: string
  /** Called for ordinary edits and on composition end — never mid-composition. */
  onValueChange: (value: string) => void
  /** Notified when a composition opens/closes (popup gating etc.). */
  onComposingChange?: (composing: boolean) => void
}

interface ImeSafeValueBindings<E extends ImeSafeElement> {
  /** What the element must display: the live draft while composing. */
  displayedValue: string
  /** True while an IME composition is in flight. */
  composing: boolean
  handleChange: (event: FormEvent<E>) => void
  handleCompositionStart: (event: CompositionEvent<E>) => void
  handleCompositionUpdate: (event: CompositionEvent<E>) => void
  handleCompositionEnd: (event: CompositionEvent<E>) => void
  handleBlur: (event: FocusEvent<E>) => void
}

/**
 * Core composition-safe value plumbing shared by the input and textarea
 * forms (cc-switch ime-safe-input mechanism, see module doc).
 */
function useImeSafeValue<E extends ImeSafeElement>(
  options: ImeSafeValueOptions,
): ImeSafeValueBindings<E> {
  const { value, onValueChange, onComposingChange } = options

  // State mirrors composingRef so the render can swap the displayed value
  // to the local draft; the ref is the event-handler-side truth (state
  // updates land on the next render, events can arrive before that).
  const [composing, setComposing] = useState(false)
  const composingRef = useRef(false)
  /** The in-flight marked text; only shown to the element, never the parent. */
  const [draft, setDraft] = useState(value)
  /**
   * Latest value the parent world knows about (the `value` prop, or the
   * value just committed synchronously). Used to suppress the duplicate
   * `input` events some engines fire after compositionend.
   */
  const externalValueRef = useRef(value)
  externalValueRef.current = value

  const setComposingState = (next: boolean) => {
    composingRef.current = next
    setComposing(next)
    onComposingChange?.(next)
  }

  /** Commit the element's current text and retire the composition. */
  const commit = (el: E) => {
    setComposingState(false)
    const next = el.value
    if (next !== externalValueRef.current) {
      externalValueRef.current = next
      onValueChange(next)
    }
  }

  return {
    displayedValue: composing ? draft : value,
    composing,
    handleChange: (event) => {
      const el = event.currentTarget
      if (composingRef.current) {
        // Marked text mid-composition: keep it local, parent sees nothing.
        setDraft(el.value)
        return
      }
      const next = el.value
      // Trailing `input` from engines that re-report the committed value
      // right after compositionend — already known, don't double-report.
      if (next === externalValueRef.current) return
      onValueChange(next)
    },
    handleCompositionStart: (event) => {
      setComposingState(true)
      // Seed the draft with the element's committed text so updates from
      // the composition never race ahead of what is actually displayed.
      setDraft(event.currentTarget.value)
    },
    handleCompositionUpdate: (event) => {
      setDraft(event.currentTarget.value)
    },
    handleCompositionEnd: (event) => {
      commit(event.currentTarget)
    },
    handleBlur: (event) => {
      // WebKit path: switching windows can drop a composition without a
      // compositionend event — blur commits whatever marked text remains.
      if (composingRef.current) commit(event.currentTarget)
    },
  }
}

export interface ImeSafeInputProps extends Omit<
  ComponentPropsWithRef<"input">,
  "value" | "onChange" | "defaultValue"
> {
  /** The authoritative committed value (controlled). */
  value: string
  /** Committed on ordinary typing and on composition end — never mid-composition. */
  onValueChange: (value: string) => void
  /** Notified when an IME composition opens/closes. */
  onComposingChange?: (composing: boolean) => void
}

/**
 * Composition-safe controlled `<input>` (cc-switch ime-safe-input
 * borrowing). Drop-in for the standard controlled pattern — rename
 * `onChange` to `onValueChange`; every other prop forwards unchanged.
 */
export function ImeSafeInput({
  value,
  onValueChange,
  onComposingChange,
  onCompositionStart,
  onCompositionUpdate,
  onCompositionEnd,
  onBlur,
  ref,
  ...rest
}: ImeSafeInputProps) {
  const ime = useImeSafeValue<HTMLInputElement>({ value, onValueChange, onComposingChange })
  return (
    <input
      {...rest}
      ref={ref}
      value={ime.displayedValue}
      onChange={ime.handleChange}
      onCompositionStart={(e) => {
        onCompositionStart?.(e)
        ime.handleCompositionStart(e)
      }}
      onCompositionUpdate={(e) => {
        onCompositionUpdate?.(e)
        ime.handleCompositionUpdate(e)
      }}
      onCompositionEnd={(e) => {
        onCompositionEnd?.(e)
        ime.handleCompositionEnd(e)
      }}
      onBlur={(e) => {
        onBlur?.(e)
        ime.handleBlur(e)
      }}
    />
  )
}

export interface ImeSafeTextareaProps extends Omit<
  ComponentPropsWithRef<"textarea">,
  "value" | "onChange" | "defaultValue"
> {
  /** The authoritative committed value (controlled). */
  value: string
  /** Committed on ordinary typing and on composition end — never mid-composition. */
  onValueChange: (value: string) => void
  /** Notified when an IME composition opens/closes. */
  onComposingChange?: (composing: boolean) => void
}

/**
 * Composition-safe controlled `<textarea>` — the multiline twin of
 * {@link ImeSafeInput}, same mechanism and same prop contract.
 */
export function ImeSafeTextarea({
  value,
  onValueChange,
  onComposingChange,
  onCompositionStart,
  onCompositionUpdate,
  onCompositionEnd,
  onBlur,
  ref,
  ...rest
}: ImeSafeTextareaProps) {
  const ime = useImeSafeValue<HTMLTextAreaElement>({ value, onValueChange, onComposingChange })
  return (
    <textarea
      {...rest}
      ref={ref}
      value={ime.displayedValue}
      onChange={ime.handleChange}
      onCompositionStart={(e) => {
        onCompositionStart?.(e)
        ime.handleCompositionStart(e)
      }}
      onCompositionUpdate={(e) => {
        onCompositionUpdate?.(e)
        ime.handleCompositionUpdate(e)
      }}
      onCompositionEnd={(e) => {
        onCompositionEnd?.(e)
        ime.handleCompositionEnd(e)
      }}
      onBlur={(e) => {
        onBlur?.(e)
        ime.handleBlur(e)
      }}
    />
  )
}
