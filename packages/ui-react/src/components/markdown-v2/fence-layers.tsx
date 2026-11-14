// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Fence layers: the extension point that lets a host replace how a markdown
 * fence renders, dispatched by fence language.
 *
 * (borrowing) Mirrors the deepseek-harness chat fence layers
 * (`ui-chat/src/client/fence/FenceLayers.tsx`): a `math` fence shows display
 * TeX once its document settles (while it streams, the inner code block
 * shows the source so a partial formula never renders as an error), and a
 * `mermaid` fence stream-draws diagrams. Unlike the deepseek seat/delegate
 * mechanism, the registry travels through React context that
 * `StreamingMarkdown` provides, so cached streaming elements follow a
 * registry change without remounting.
 */

import { createContext } from "react"
import type { ComponentType, ReactNode } from "react"
import { TeXMath } from "./katex-math.js"
import { MermaidFenceLayer } from "./mermaid-fence-layer.js"

/** Props every fence layer receives. */
export interface FenceLayerProps {
  /** The fence language as parsed (info string's first token, verbatim case). */
  readonly lang: string
  /** The fence info string beyond the language; `undefined` when absent. */
  readonly meta: string | undefined
  /** The fence body accumulated so far (without delimiters). */
  readonly code: string
  /** Whether the surrounding document is still streaming. */
  readonly streaming: boolean
  /**
   * The default inner rendering (the code block). A layer that cannot draw
   * yet — a streaming `math` fence, a Mermaid fragment still parsing —
   * renders this so the source stays visible.
   */
  readonly children: ReactNode
}

/** A component that takes over one fence language's rendering. */
export type FenceLayer = ComponentType<FenceLayerProps>

/** Fence layers keyed by lower-cased fence language. */
export type FenceLayers = Readonly<Record<string, FenceLayer>>

/** Registry read by the renderer's fence seats; absent = plain code blocks. */
export const FenceLayersContext = createContext<FenceLayers | undefined>(undefined)

/**
 * The built-in layers shipped with the module: display math and Mermaid
 * diagrams. Hosts spread these before their own layers, which then override
 * by language key.
 */
export const builtinFenceLayers: FenceLayers = {
  math: MathFenceLayer,
  mermaid: MermaidFenceLayer,
}

/**
 * Show a `math` fence as display TeX once its document settles; while it
 * streams, the inner code block shows the source so a partial formula never
 * renders as an error.
 * @param props - the fence and the inner content.
 * @returns the formula, or the inner content while streaming.
 */
export function MathFenceLayer({ code, streaming, children }: FenceLayerProps): ReactNode {
  return streaming ? children : <TeXMath tex={code} display />
}
