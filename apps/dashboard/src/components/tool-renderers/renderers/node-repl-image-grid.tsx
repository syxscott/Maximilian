// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * node-repl-image-grid renderer — images emitted by a script
 * (nodeRepl.emitImage). Every entry is classified by
 * repl.model.ts classifyImage: data: URIs and http(s) URLs draw as a
 * defensive <img> grid (broken sources degrade to the alt label), bare
 * file paths list as monospace text; JSON fallback when the payload is
 * opaque.
 */

import { useLocale, t } from "@max/i18n"
import type { ToolCallProps } from "../registry"
import { FieldRows, JsonFallback } from "./common"
import { extractNodeReplImageGrid } from "./repl.model"

export const NODE_REPL_IMAGE_GRID_GLYPH = "▦"

export function NodeReplImageGridBody({ input }: ToolCallProps) {
  useLocale()
  const vm = extractNodeReplImageGrid(input)
  if (vm.isEmpty) return <JsonFallback input={input} />
  const drawable = vm.images.filter((img) => img.src !== undefined)
  const paths = vm.images.filter((img) => img.path !== undefined)
  return (
    <div className="mt-1" data-testid="tool-body">
      <p
        className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground"
        data-testid="tool-title"
      >
        {t("toolRenderers.node-repl-image-grid.title")}
      </p>
      <FieldRows rows={vm.rows} />
      {drawable.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-2" data-testid="repl-image-grid">
          {drawable.map((img, i) => (
            <img
              // Position identifies the entry; the payloads are unkeyed.
              key={`${img.src ?? "src"}-${i}`}
              src={img.src}
              alt={`#${i + 1}`}
              loading="lazy"
              className="max-h-40 max-w-[50%] rounded border border-border/60 object-contain"
              data-testid="repl-image"
            />
          ))}
        </div>
      )}
      {paths.length > 0 && (
        <ul className="mt-1 space-y-0.5" data-testid="repl-image-paths">
          {paths.map((img, i) => (
            <li key={`${img.path ?? "path"}-${i}`} className="break-all font-mono text-xs">
              {img.path}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
