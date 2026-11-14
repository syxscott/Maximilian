// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * markdown-v2 — incremental streaming markdown pipeline.
 *
 * (borrowing) Ported from the deepseek-harness client markdown module.
 * Public surface: the `StreamingMarkdown` component and its fence-layer
 * contract, plus the parser internals the tests (and hosts with unusual
 * needs) exercise directly.
 */

export { StreamingMarkdown } from "./streaming-markdown.js"
export type { StreamingMarkdownProps } from "./streaming-markdown.js"
export { StreamingRenderer } from "./streaming.js"
export { IncrementalMarkdownParser } from "./incremental.js"
export type { IncrementalBlocks, PositionedBlock } from "./incremental.js"
export { parseGfm, parseGfmWithMath } from "./parse.js"
export { copyKatexAsTex } from "./copy-tex.js"
export { TeXMath } from "./katex-math.js"
export type { TeXMathProps } from "./katex-math.js"
export { MathFenceLayer, builtinFenceLayers, FenceLayersContext } from "./fence-layers.js"
export type { FenceLayer, FenceLayerProps, FenceLayers } from "./fence-layers.js"
export { MermaidFenceLayer } from "./mermaid-fence-layer.js"
export type { MermaidFenceLayerProps } from "./mermaid-fence-layer.js"
export {
  collectReferenceTargets,
  createReferenceTargets,
  renderBlocks,
  renderFootnoteSection,
  wrapBlockChildren,
} from "./render.js"
export type { MarkdownRenderContext, ReferenceTargets } from "./render.js"
