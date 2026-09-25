// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * ToolCallBlock — the renderer registry (ZCode ToolCallBlocks borrowing:
 * resolveRenderer + per-tool renderers). One <ToolCallBlock> renders any
 * tool call; the registry picks the per-tool presentation and falls back
 * to a generic key/value view for tools without a dedicated renderer.
 * The collapsed line is always: icon · tool · one-line summary · outcome —
 * with a failure error it also carries that error as a single-line,
 * truncated red row (full text in the title tooltip); the expanded detail
 * mounts the ai-elements widgets that apply to every tool: LatencyMeter
 * for the measured call duration and ErrorBlock for the failure path.
 */

import { useState, type ComponentType } from "react"
import { Badge } from "@/components/ui/badge"
import { ErrorBlock, LatencyMeter } from "@/components/ai-elements"
import { RENDERERS } from "./renderers"
import { summarizeToolInput, toolInputRows } from "./model"

export interface ToolCallProps {
  tool: string
  input: unknown
  ok?: boolean
  durationMs?: number
  error?: string
  /** Default collapsed state (timeline uses collapsed, review uses open). */
  defaultOpen?: boolean
}

export interface ToolRendererDef {
  /** Small glyph for the collapsed row. */
  glyph: string
  /** Optional custom body; default renders the extracted key/value rows. */
  Body?: ComponentType<ToolCallProps>
}

function DefaultBody({ tool, input }: ToolCallProps) {
  const { rows } = toolInputRows(tool, input)
  return (
    <dl className="mt-1 space-y-1" data-testid="tool-body">
      {rows.map((row) => (
        <div key={row.label} className="grid grid-cols-[88px_minmax(0,1fr)] gap-2">
          <dt className="text-[10px] uppercase text-muted-foreground">{row.label}</dt>
          <dd className={`whitespace-pre-wrap break-all text-xs ${row.mono ? "font-mono" : ""}`}>
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}

// RENDERERS lives in ./renderers/index.ts — one glyph + Body per ZCode
// ToolCallBlocks category; unlisted tools fall back to the generic view.
const FALLBACK_RENDERER: ToolRendererDef = { glyph: "·" }

export function resolveToolRenderer(tool: string): ToolRendererDef {
  return RENDERERS[tool] ?? FALLBACK_RENDERER
}

export function ToolCallBlock(props: ToolCallProps) {
  const { tool, ok, durationMs, error, defaultOpen = false } = props
  const [open, setOpen] = useState(defaultOpen)
  const renderer = resolveToolRenderer(tool)
  const Body = renderer.Body ?? DefaultBody

  return (
    <div
      className="rounded-md border border-border/60 bg-muted/30"
      data-testid={`tool-call-${tool}`}
    >
      <button
        type="button"
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <span className="w-4 shrink-0 text-center font-mono text-muted-foreground">
          {renderer.glyph}
        </span>
        <span className="font-mono font-medium">{tool}</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          {summarizeToolInput(tool, props.input)}
        </span>
        {durationMs !== undefined && (
          <span className="shrink-0 text-[10px] text-muted-foreground">{durationMs}ms</span>
        )}
        {ok === true && (
          <Badge variant="secondary" className="h-4 shrink-0 px-1 text-[10px]">
            ✓
          </Badge>
        )}
        {ok === false && (
          <Badge variant="destructive" className="h-4 shrink-0 px-1 text-[10px]">
            ✗
          </Badge>
        )}
      </button>
      {!open && error && (
        <p
          className="truncate border-t border-destructive/30 px-2 py-1 text-xs text-destructive"
          title={error}
          data-testid="tool-error-collapsed"
        >
          {error}
        </p>
      )}
      {open && (
        <div className="border-t border-border/60 px-2 py-1.5">
          {durationMs !== undefined && <LatencyMeter ms={durationMs} className="mb-1" />}
          <Body {...props} />
          {error && (
            <div className="mt-1" data-testid="tool-error">
              <ErrorBlock error={error} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
