// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * jsdom geometry helper: pin an element's getBoundingClientRect so the
 * anchored-position flip logic sees a non-zero layout (jsdom reports
 * empty rects everywhere).
 */

export interface FakeRect {
  top: number
  bottom: number
  left: number
  width: number
}

/** Pin `el.getBoundingClientRect` to a fixed rect (returns a cleanup). */
export function anchoredPositionFor(el: Element, rect: FakeRect): () => void {
  const original = el.getBoundingClientRect.bind(el)
  el.getBoundingClientRect = (): DOMRect =>
    ({
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.bottom - rect.top,
      top: rect.top,
      right: rect.left + rect.width,
      bottom: rect.bottom,
      left: rect.left,
      toJSON: () => rect,
    }) as DOMRect
  return () => {
    el.getBoundingClientRect = original
  }
}
