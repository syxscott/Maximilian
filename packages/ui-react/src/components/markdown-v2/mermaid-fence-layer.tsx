// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * `mermaid` fence layer: stream-draws the newest complete fragment while the
 * document streams, keeps the last successful diagram over transient parse
 * failures, and surfaces render errors only once the document settles.
 *
 * (borrowing) Mechanism ported from chat-demo `components/markdown/
 * MermaidDiagram.tsx`: during streaming the effect loop polls the latest
 * source through a ref (successive fragments coalesce into one draw), a
 * failed fragment retries once with the prefix up to its last line break
 * (the final line often holds a half-written node), and a shown diagram is
 * retained whenever the current content extends it. A theme flip redraws.
 */

import { memo, useEffect, useRef, useState } from "react"
import type { ReactNode } from "react"
import { renderMermaid } from "../../lib/mermaid-render.js"

/** Batch interval between streaming draw attempts (chat-demo's cadence). */
const STREAM_DRAW_INTERVAL_MS = 100

/**
 * Track the document's resolved color scheme without coupling to a theme
 * provider: the host root's `data-theme` attribute when present, else the
 * media query, re-evaluated on attribute or scheme changes.
 */
function useDocumentDark(): boolean {
  const [dark, setDark] = useState(() => {
    if (typeof document === "undefined") return false
    const theme = document.documentElement.dataset.theme
    if (theme === "dark") return true
    if (theme === "light") return false
    return typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
      : false
  })
  useEffect(() => {
    if (typeof MutationObserver === "undefined") return
    const read = () => {
      const theme = document.documentElement.dataset.theme
      if (theme === "dark") setDark(true)
      else if (theme === "light") setDark(false)
    }
    const observer = new MutationObserver(read)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    })
    return () => {
      observer.disconnect()
    }
  }, [])
  return dark
}

export interface MermaidFenceLayerProps {
  /** Fence language (always `mermaid` when dispatched by the registry). */
  lang: string
  /** Fence info string beyond the language; unused. */
  meta: string | undefined
  /** The fence body accumulated so far. */
  code: string
  /** Whether the surrounding document is still streaming. */
  streaming: boolean
  /** The default inner rendering; shown before the first diagram draws. */
  children: ReactNode
}

/**
 * Render a `mermaid` fence body as a diagram.
 * @param props - fence body, streaming state, and the inner code block.
 * @returns The SVG diagram once one draws; the inner code block while
 * waiting; an error status only after the document settled and no diagram
 * could render.
 */
export const MermaidFenceLayer = memo(function MermaidFenceLayer({
  code,
  streaming,
  children,
}: MermaidFenceLayerProps): ReactNode {
  const dark = useDocumentDark()
  const [result, setResult] = useState({ svg: "", failedCode: null as string | null })
  const latestCodeRef = useRef(code)
  latestCodeRef.current = code
  // While streaming, read the newest text through the ref so consecutive
  // fragments coalesce instead of cancelling each other's draw; settled,
  // draw the full content immediately (the dependency that restarts the loop).
  const finalCode = streaming ? null : code

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let previousCode: string | undefined
    let displayedCode: string | undefined

    const draw = async (input: string) => {
      if (input === displayedCode || cancelled) {
        return
      }
      const svg = await renderMermaid(input, dark, () => cancelled)
      if (svg && !cancelled) {
        displayedCode = input
        setResult({ svg, failedCode: null })
      }
    }

    const renderLatest = async () => {
      const input = latestCodeRef.current
      if (input !== previousCode) {
        previousCode = input
        try {
          await draw(input)
        } catch {
          if (!cancelled) {
            if (streaming) {
              // A streaming fragment's last line may hold an unfinished node;
              // draw only the complete lines before it.
              const text = input.trimEnd()
              const lineEnd = Math.max(text.lastIndexOf("\n"), text.lastIndexOf("\r"))
              const prefix = text.slice(0, Math.max(0, lineEnd))
              // Keep the shown diagram when the displayed content already
              // covers this prefix (the fragment added only an invalid tail).
              if (prefix && !displayedCode?.startsWith(prefix)) {
                try {
                  await draw(prefix)
                } catch {
                  // The prefix may not be complete syntax either; keep the
                  // last successful diagram.
                }
              }
            } else {
              setResult({ svg: "", failedCode: input })
            }
          }
        }
      }
      // Draw the newest fragment when this frame ends; consecutive input
      // coalesces into one draw.
      if (!cancelled && streaming) {
        timer = setTimeout(() => {
          void renderLatest()
        }, STREAM_DRAW_INTERVAL_MS)
      }
    }

    void renderLatest()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [dark, streaming, finalCode])

  if (!code.trim() || !result.svg) {
    if (streaming) return children
    if (!code.trim()) return children
    if (result.failedCode === code) {
      return (
        <div
          data-mermaid-status="failed"
          role="status"
          className="rounded-md border border-dashed border-border px-3 py-3 text-xs text-muted-foreground"
        >
          This Mermaid diagram could not be rendered.
        </div>
      )
    }
    return children
  }

  return <div data-mermaid-status="rendered" dangerouslySetInnerHTML={{ __html: result.svg }} />
})
