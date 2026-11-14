// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * StreamingMarkdown binding — the TextUnitBlock body renderer.
 *
 * CROSS-AGENT CONTRACT with packages/ui-react, now DELIVERED: the real
 * incremental renderer (@max/ui-react/markdown-v2, deepseek-harness
 * borrowing) renders AI markdown bodies — code fences, tables, lists,
 * math, mermaid — with streaming-aware frozen-block flushing; props per
 * contract: `{ text, settled, fenceLayers?, onCopy? }` where
 * `settled: false` while the text is still streaming.
 *
 * `fenceLayers` on the delivery is a Record<string, FenceLayer> of fence
 * languages, not a depth hint; the binding keeps TextUnitBlock's call
 * sites unchanged and simply forwards the whole shape when provided.
 */

import { StreamingMarkdown as UiStreamingMarkdown } from "@max/ui-react/markdown-v2"
import type { FenceLayers } from "@max/ui-react/markdown-v2"
import type { ClipboardEventHandler } from "react"

export interface StreamingMarkdownProps {
  /** The body text — markdown while streaming. */
  text: string
  /** false while the text is still streaming (drives flush behavior). */
  settled: boolean
  /** Fence-language layers (math/mermaid built in; override to extend). */
  fenceLayers?: FenceLayers
  /** Copy affordance hook (forwards to the renderer's onCopy). */
  onCopy?: ClipboardEventHandler<HTMLDivElement>
}

/**
 * The single binding point. AI bodies are real markdown (code fences,
 * tables, math) — TextUnitBlock now renders them incrementally.
 */
export function StreamingMarkdown(props: StreamingMarkdownProps) {
  return <UiStreamingMarkdown {...props} />
}
