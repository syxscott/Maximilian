// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * TeX math rendered through lazily-loaded KaTeX, retaining the last
 * successful render while the source is still incomplete.
 *
 * (borrowing) Mechanism ported from chat-demo `components/markdown/
 * MathFormula.tsx`: KaTeX imports on first use (no formula, no katex chunk);
 * a render failure keeps the previous successful result — a streaming
 * formula is written in pieces, so the intermediate `\frac{1}{` must not
 * flash a KaTeX error — and with no previous result the raw TeX shows. The
 * wrapper spans `renderToString` emits are sliced off here because the
 * component renders its own outer element, which also carries the display
 * variant's `katex-display` class the copy-tex projection keys on.
 */

import { memo, useEffect, useMemo, useRef, useState } from "react"
import { cn } from "../../lib/utils.js"
import { ensureKatex } from "./katex-lazy.js"
import type { Katex } from "./katex-lazy.js"

/** `renderToString` outer wrappers; the component renders these itself. */
const KATEX_WRAPPER = {
  inline: ['<span class="katex">', "</span>"],
  display: ['<span class="katex-display"><span class="katex">', "</span></span>"],
} as const

type MathHtmlResult = {
  html: string
  renderMode: "katex" | "fallback"
}

const noop = (): void => {}

/** Render one formula through KaTeX, keeping the last success across failures. */
function useMathHtml(input: string, isInline: boolean): MathHtmlResult {
  const previousResultRef = useRef<MathHtmlResult | null>(null)
  const katexRef = useRef<Katex | Promise<Katex> | null>(null)
  if (katexRef.current === null) katexRef.current = ensureKatex()
  const [katex, setKatex] = useState<Katex | null>(
    katexRef.current instanceof Promise ? null : katexRef.current,
  )

  useEffect(() => {
    const pending = katexRef.current
    if (pending instanceof Promise) {
      void pending.then(setKatex, noop)
    }
  }, [])

  return useMemo((): MathHtmlResult => {
    if (!katex) return { html: input, renderMode: "fallback" }
    try {
      const [prefix, suffix] = KATEX_WRAPPER[isInline ? "inline" : "display"]
      const html = katex
        .renderToString(input, { throwOnError: true, strict: false, displayMode: !isInline })
        .slice(prefix.length, -suffix.length)
      const result = { html, renderMode: "katex" } as const
      previousResultRef.current = result
      return result
    } catch {
      return previousResultRef.current ?? { html: input, renderMode: "fallback" }
    }
  }, [input, isInline, katex])
}

export interface TeXMathProps {
  /** The TeX source of one formula. */
  tex: string
  /** Display (block) versus inline rendering. Defaults to false. */
  display?: boolean | undefined
  /** Extra class on the outer wrapper. */
  className?: string | undefined
}

/**
 * Render one TeX formula through lazily-loaded KaTeX.
 * @param props - TeX source, display/inline choice, wrapper class.
 * @returns The typeset formula; while KaTeX loads or the source does not
 * (yet) parse, the raw TeX text — never a KaTeX error, and a previously
 * rendered formula stays until a new one succeeds.
 */
export const TeXMath = memo(function TeXMath({ tex, display = false, className }: TeXMathProps) {
  const { html, renderMode } = useMathHtml(tex, !display)
  if (renderMode === "fallback") {
    // Raw TeX text: KaTeX not loaded yet, or the source does not parse and
    // no earlier formula succeeded (a streaming formula mid-write).
    return <span className={cn("katex-source", className)}>{tex}</span>
  }
  if (display) {
    return (
      <span className={cn("katex-display", className)}>
        <span className="katex" dangerouslySetInnerHTML={{ __html: html }} />
      </span>
    )
  }
  return <span className={cn("katex", className)} dangerouslySetInnerHTML={{ __html: html }} />
})
