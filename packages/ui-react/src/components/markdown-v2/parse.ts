// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * The markdown-v2 renderer's two mdast grammars, one per rendering arm.
 *
 * (borrowing) Mirrors the deepseek-harness client `markdown/parse.ts` arm
 * split: each arm is internally consistent — the incremental tail parses,
 * the one-shot parses, and the plain-text projection of a given grammar
 * always agree on where blocks start and end — and the settled grammar is
 * the streaming one plus the math extensions, so the arms differ only where
 * TeX delimiters begin a math construct (a `$$` block is a paragraph while
 * streaming and a math block once settled, by design). GFM v3 bundles
 * footnotes, so both arms resolve `[^id]` references and definitions.
 */

import type { Root } from "mdast"
import { fromMarkdown } from "mdast-util-from-markdown"
import { gfmFromMarkdown } from "mdast-util-gfm"
import { mathFromMarkdown } from "mdast-util-math"
import { gfm } from "micromark-extension-gfm"
import { math } from "micromark-extension-math"

/** GFM strikethrough requires `~~`; a single `~` stays literal, as in ranges such as `10~20`. */
const gfmOptions = { singleTilde: false }

/**
 * Parse GFM markdown (the streaming arm's grammar: no math, so incomplete
 * TeX never flashes KaTeX errors mid-stream).
 * @param text - Markdown source.
 * @returns The mdast root.
 */
export function parseGfm(text: string): Root {
  return fromMarkdown(text, {
    extensions: [gfm(gfmOptions)],
    mdastExtensions: [gfmFromMarkdown()],
  })
}

/**
 * Parse GFM markdown plus TeX math (`$…$` inline and `$$…$$` display; the
 * settled arm's grammar).
 * @param text - Markdown source.
 * @returns The mdast root.
 */
export function parseGfmWithMath(text: string): Root {
  return fromMarkdown(text, {
    extensions: [gfm(gfmOptions), math()],
    mdastExtensions: [gfmFromMarkdown(), mathFromMarkdown()],
  })
}
