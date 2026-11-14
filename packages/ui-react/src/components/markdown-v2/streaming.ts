// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Streaming render state for one growing message.
 *
 * (borrowing) Ported from the deepseek-harness `MarkdownText.tsx` renderer
 * class: the incremental parser, the frozen blocks' cached elements, and the
 * reference/footnote state their rendering consumed (footnote numbering
 * assigned to frozen references is final, so the tail continues from a copy
 * of it each frame).
 */

import type { ReactNode } from "react"
import { IncrementalMarkdownParser } from "./incremental.js"
import { parseGfm } from "./parse.js"
import {
  collectReferenceTargets,
  createReferenceTargets,
  renderBlocks,
  renderFootnoteSection,
} from "./render.js"
import type { MarkdownRenderContext, ReferenceTargets } from "./render.js"

/**
 * Render the current accumulated text through the streaming arm. Idempotent
 * per text value, so React may re-execute the calling render freely.
 */
export class StreamingRenderer {
  private readonly parser: IncrementalMarkdownParser
  private generation = -1
  private frozenCount = 0
  private frozenElements: ReactNode[] = []
  private frozenTargets: ReferenceTargets = createReferenceTargets()
  private frozenFootnoteOrder: string[] = []
  private frozenFootnoteCounts = new Map<string, number>()
  private lastText: string | null = null
  private lastRendered: ReactNode[] = []
  /** Raw HTML renders nothing instead of literal text; a change replaces the renderer. */
  readonly omitHtml: boolean

  /**
   * @param omitHtml - Whether raw HTML renders nothing; the owner replaces the renderer when it changes.
   */
  constructor(omitHtml = false) {
    this.omitHtml = omitHtml
    this.parser = new IncrementalMarkdownParser(parseGfm)
  }

  /**
   * Render the current accumulated text.
   * @param text - The full accumulated markdown source.
   * @returns Frozen elements, re-rendered tail, and the footnote section.
   */
  render(text: string): ReactNode[] {
    if (text === this.lastText) return this.lastRendered
    const { frozen, tail, generation } = this.parser.update(text)
    if (generation !== this.generation) {
      this.generation = generation
      this.frozenCount = 0
      this.frozenElements = []
      this.frozenTargets = createReferenceTargets()
      this.frozenFootnoteOrder = []
      this.frozenFootnoteCounts = new Map()
    }
    const newlyFrozen = frozen.slice(this.frozenCount)
    collectReferenceTargets(
      newlyFrozen.map((block) => block.node),
      this.frozenTargets,
    )
    // Targets visible this frame: everything frozen so far plus the current
    // tail parse — a newly frozen block's references resolved against the
    // same parse tree its definitions came from.
    const frameTargets: ReferenceTargets = {
      definitions: new Map(this.frozenTargets.definitions),
      footnotes: new Map(this.frozenTargets.footnotes),
    }
    collectReferenceTargets(
      tail.map((block) => block.node),
      frameTargets,
    )
    if (newlyFrozen.length > 0) {
      const frozenContext: MarkdownRenderContext = {
        streaming: true,
        omitHtml: this.omitHtml,
        targets: frameTargets,
        footnoteOrder: this.frozenFootnoteOrder,
        footnoteCounts: this.frozenFootnoteCounts,
      }
      // Separator newlines are cached alongside the elements so the
      // assembled children match the settled pipeline's block wrapping.
      const batch = [...this.frozenElements]
      for (const element of renderBlocks(newlyFrozen, frozenContext)) {
        if (batch.length > 0) batch.push("\n")
        batch.push(element)
      }
      this.frozenElements = batch
      this.frozenCount = frozen.length
    }
    const tailContext: MarkdownRenderContext = {
      streaming: true,
      omitHtml: this.omitHtml,
      targets: frameTargets,
      footnoteOrder: [...this.frozenFootnoteOrder],
      footnoteCounts: new Map(this.frozenFootnoteCounts),
    }
    const children = [...this.frozenElements]
    for (const element of renderBlocks(tail, tailContext)) {
      if (children.length > 0) children.push("\n")
      children.push(element)
    }
    const section = renderFootnoteSection(tailContext)
    if (section !== null) children.push("\n", section)
    this.lastText = text
    this.lastRendered = children
    return this.lastRendered
  }
}
