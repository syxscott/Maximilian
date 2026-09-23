// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Shared presentation pieces for the per-tool renderers. Every body is the
 * same shape: labeled field rows, an optional monospace code block, and a
 * generic JSON preview when the model layer found nothing — so each
 * <tool>.tsx stays a glyph + a thin Body over its extractor.
 */

import { useLocale, t } from "@max/i18n"
import {
  asRecord,
  jsonPreview,
  truncateLines,
  type RendererRow,
  type ToolViewModel,
} from "./shared.model"

/** Labeled field rows (same grid as the registry DefaultBody). */
export function FieldRows({ rows }: { rows: RendererRow[] }) {
  useLocale()
  if (rows.length === 0) return null
  return (
    <dl className="space-y-1" data-testid="tool-fields">
      {rows.map((row) => (
        <div key={row.labelKey} className="grid grid-cols-[88px_minmax(0,1fr)] gap-2">
          <dt className="text-[10px] uppercase text-muted-foreground">{t(row.labelKey)}</dt>
          <dd className={`whitespace-pre-wrap break-all text-xs ${row.mono ? "font-mono" : ""}`}>
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}

/** Monospace code block with line-count clamping. */
export function CodeBlock({ text, maxLines = 20 }: { text: string; maxLines?: number }) {
  useLocale()
  const { text: visible, overflow } = truncateLines(text, maxLines)
  return (
    <div className="mt-1">
      <pre
        className="max-h-48 overflow-auto rounded border border-border/60 bg-muted/40 p-2 text-xs font-mono leading-5 m-0 whitespace-pre-wrap break-all"
        data-testid="tool-code"
      >
        {visible}
      </pre>
      {overflow > 0 && (
        <p className="mt-0.5 text-[10px] text-muted-foreground" data-testid="tool-code-overflow">
          {t("toolRenderers.code.overflow", { count: overflow })}
        </p>
      )}
    </div>
  )
}

/** Generic fallback: clamped JSON of the raw input (defensive landing). */
export function JsonFallback({ input }: { input: unknown }) {
  useLocale()
  const obj = asRecord(input)
  const hasKeys = Object.keys(obj).length > 0
  return (
    <div className="mt-1" data-testid="tool-json-preview">
      <p className="text-[10px] uppercase text-muted-foreground">
        {hasKeys ? t("toolRenderers.json.raw") : t("toolRenderers.json.empty")}
      </p>
      {hasKeys && (
        <pre className="max-h-40 overflow-auto rounded border border-border/60 bg-muted/40 p-2 text-xs font-mono leading-5 m-0 whitespace-pre-wrap break-all">
          {jsonPreview(input)}
        </pre>
      )}
    </div>
  )
}

/** Standard body shell: localized title + rows + optional code, JSON
 *  fallback when empty. */
export function BodyShell({
  vm,
  input,
  titleKey,
}: {
  vm: ToolViewModel
  input: unknown
  /** i18n key of this renderer's localized title. */
  titleKey: string
}) {
  useLocale()
  if (vm.isEmpty) return <JsonFallback input={input} />
  return (
    <div className="mt-1" data-testid="tool-body">
      <p
        className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground"
        data-testid="tool-title"
      >
        {t(titleKey)}
      </p>
      <FieldRows rows={vm.rows} />
      {vm.code && <CodeBlock text={vm.code.text} maxLines={vm.code.maxLines} />}
    </div>
  )
}
