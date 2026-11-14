// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * `StreamingMarkdown` — untrusted assistant-markdown renderer over the
 * direct mdast pipeline: the `parse.ts` grammars, the incremental streaming
 * parser, the cached-element `StreamingRenderer`, and the mdast→React
 * renderer.
 *
 * (borrowing) Component surface and behavior ported from deepseek-harness
 * `MarkdownText.tsx`. While a message streams (`settled: false`), all but
 * the trailing two blocks freeze as cached React elements and only the
 * source tail behind them re-parses per chunk, so per-chunk work tracks the
 * tail size instead of the whole reply. Frozen blocks keep their
 * source-offset keys when they cross the freeze boundary, so React
 * reconciles instead of remounting. Known deviation while streaming: a
 * reference-style link or footnote whose definition sits on the other side
 * of the freeze boundary renders literally until the settled full parse
 * self-heals it.
 *
 * `settled: true` parses once with the math-enabled grammar, so `$$…$$`
 * blocks and inline `$…$` TeX render through the lazy KaTeX component, and
 * reference/footnote resolution is document-wide. `math` and `mermaid`
 * fences dispatch to the built-in layers (source visible while streaming);
 * `fenceLayers` adds or overrides languages. Copying a selection inside the
 * document writes selected formulas as `$…$` / `$$…$$` TeX source.
 */

import { memo, useMemo, useRef } from "react"
import type { ClipboardEventHandler, ReactElement, ReactNode } from "react"
import { cn } from "../../lib/utils.js"
import { copyKatexAsTex } from "./copy-tex.js"
import { FenceLayersContext, builtinFenceLayers } from "./fence-layers.js"
import type { FenceLayers } from "./fence-layers.js"
import { parseGfmWithMath } from "./parse.js"
import { StreamingRenderer } from "./streaming.js"
import {
  collectReferenceTargets,
  createReferenceTargets,
  renderBlocks,
  renderFootnoteSection,
  wrapBlockChildren,
} from "./render.js"
import type { MarkdownRenderContext } from "./render.js"

/** One settled full render: parse with math, resolve references, append the footnote section. */
function renderSettled(text: string, omitHtml: boolean): ReactNode[] {
  const root = parseGfmWithMath(text)
  const targets = createReferenceTargets()
  collectReferenceTargets(root.children, targets)
  const context: MarkdownRenderContext = {
    streaming: false,
    omitHtml,
    targets,
    footnoteOrder: [],
    footnoteCounts: new Map(),
  }
  const blocks = wrapBlockChildren(
    renderBlocks(
      root.children.map((node, index) => ({
        node,
        /* v8 ignore next -- parseGfmWithMath stamps every top-level node. */
        key: node.position?.start.offset ?? -(index + 1),
      })),
      context,
    ),
    false,
  )
  const section = renderFootnoteSection(context)
  return section === null ? blocks : [...blocks, "\n", section]
}

export interface StreamingMarkdownProps {
  /** The full accumulated markdown source. */
  text: string
  /** Whether the stream has ended; `false` renders incrementally with TeX and fence layers deferred. */
  settled: boolean
  /**
   * Extra fence layers keyed by lower-cased fence language, layered over the
   * built-in math and mermaid layers (same-key entries override). Pass a
   * reference-stable object — a new identity rebuilds the registry, and while
   * streaming it re-renders the cached tail.
   */
  fenceLayers?: FenceLayers | undefined
  /** Raw HTML renders nothing instead of literal text. Defaults to false. */
  omitHtml?: boolean | undefined
  /**
   * Additional copy handler on the document root, invoked after the built-in
   * copy-tex projection (which only rewrites selections containing rendered
   * formulas and never fires without them).
   */
  onCopy?: ClipboardEventHandler<HTMLDivElement> | undefined
  /** Extra class merged onto the root document element. */
  className?: string | undefined
}

/**
 * Render untrusted assistant-authored Markdown as semantic React elements.
 * @param props - `text` is the current full source and `settled` whether the
 * stream has ended. See the module doc for the streaming behavior and the
 * fence-layer contract.
 * @returns A GFM document with TeX math rendered through KaTeX once settled;
 * raw HTML never renders as markup, and unsafe protocols are disabled.
 */
export const StreamingMarkdown = memo(function StreamingMarkdown({
  text,
  settled,
  fenceLayers,
  omitHtml = false,
  onCopy,
  className,
}: StreamingMarkdownProps): ReactElement {
  const streamRef = useRef<StreamingRenderer | null>(null)
  const children = useMemo(() => {
    if (settled) {
      streamRef.current = null
      return renderSettled(text, omitHtml)
    }
    if (streamRef.current === null || streamRef.current.omitHtml !== omitHtml) {
      streamRef.current = new StreamingRenderer(omitHtml)
    }
    return streamRef.current.render(text)
  }, [text, settled, omitHtml])
  const layers = useMemo(() => ({ ...builtinFenceLayers, ...(fenceLayers ?? {}) }), [fenceLayers])
  return (
    <FenceLayersContext.Provider value={layers}>
      <div
        data-component="streaming-markdown"
        className={cn("mdv-markdown", className)}
        onCopy={(event) => {
          copyKatexAsTex(event.nativeEvent, event.currentTarget)
          onCopy?.(event)
        }}
      >
        {children}
      </div>
    </FenceLayersContext.Provider>
  )
})
