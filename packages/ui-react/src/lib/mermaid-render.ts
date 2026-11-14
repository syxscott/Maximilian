// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Serial Mermaid rendering service. Mermaid imports lazily — a session that
 * never renders a diagram pays neither the module nor its init.
 *
 * (borrowing) Ported from chat-demo `services/markdown/mermaid.ts`: renders
 * run through a promise queue so concurrent diagrams cannot interleave
 * Mermaid's global configuration; a failed render does not block later
 * diagrams (the caller still receives the original error). `<img>`/`<image>`
 * tags are neutralized before rendering, Mermaid's `securityLevel: "strict"`
 * notwithstanding, so a diagram author cannot inject image loads.
 */

type Mermaid = typeof import("mermaid").default

let mermaidPromise: Promise<Mermaid> | null = null
let renderQueue: Promise<unknown> = Promise.resolve()
let nextId = 0

/** Load (once) and keep the module; a failed load clears the cache for retry. */
function loadMermaid(): Promise<Mermaid> {
  mermaidPromise ??= import("mermaid")
    .then((module) => module.default)
    .catch((error: unknown) => {
      mermaidPromise = null
      throw error
    })
  return mermaidPromise
}

/** Escape image tags; the neutralization applies to every tag in the diagram. */
const sanitizeMermaid = (code: string): string => code.replace(/<((?:img|image)\s+)/gi, "&lt;$1")

/**
 * Render one Mermaid diagram to SVG markup.
 * @param code - The diagram source.
 * @param dark - Whether to render the dark theme.
 * @param isCancelled - Poll after each await; a stale render (newer source
 * arrived, or the component unmounted) returns `null` instead of SVG.
 * @returns The SVG markup, or `null` when cancelled or empty.
 */
export const renderMermaid = (
  code: string,
  dark: boolean,
  isCancelled: () => boolean,
): Promise<string | null> => {
  const result = renderQueue.then(async (): Promise<string | null> => {
    if (isCancelled() || !code.trim()) {
      return null
    }
    const mermaid = await loadMermaid()
    if (isCancelled()) {
      return null
    }
    mermaid.initialize({
      theme: dark ? "dark" : "default",
      securityLevel: "strict",
      startOnLoad: false,
      suppressErrorRendering: true,
    })
    const { svg } = await mermaid.render(
      `maximilian-mermaid-${(nextId += 1)}`,
      sanitizeMermaid(code),
    )
    return isCancelled() ? null : svg
  })
  // A failed render must not poison the queue; the caller still gets the error.
  renderQueue = result.then(
    () => {},
    () => {},
  )
  return result
}
