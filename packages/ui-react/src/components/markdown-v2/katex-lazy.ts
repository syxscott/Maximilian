// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * On-demand KaTeX loader. The module (and its stylesheet) stays out of every
 * bundle until the first formula renders.
 *
 * (borrowing) Ported from chat-demo `services/markdown/katex.ts`: already
 * loaded resolves synchronously; the first caller starts the import (once)
 * and every caller shares that promise. A failed import clears the cached
 * promise so a later formula may retry.
 */

export type Katex = typeof import("katex").default

let katex: Katex | null = null
let katexPromise: Promise<Katex> | null = null

/**
 * Load KaTeX and its stylesheet on demand; synchronous once loaded.
 * @returns The module, or the in-flight load promise for the first caller.
 */
export function ensureKatex(): Katex | Promise<Katex> {
  if (katex !== null) return katex
  katexPromise ??= Promise.all([import("katex"), import("katex/dist/katex.min.css")]).then(
    ([module]) => {
      katex = module.default
      return katex
    },
  )
  return katexPromise
}
