// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * node-repl renderer — run a script in the persistent Node kernel. The
 * body shows the script title as a heading, the timeout/line-count rows,
 * and the code itself as a clamped monospace block with an overflow note
 * (repl.model.ts extractNodeRepl); JSON fallback when the payload is
 * opaque.
 */

import { useLocale, t } from "@max/i18n"
import type { ToolCallProps } from "../registry"
import { CodeBlock, FieldRows, JsonFallback } from "./common"
import { extractNodeRepl } from "./repl.model"
import { FIELDS } from "./shared.model"

export const NODE_REPL_GLYPH = "❯"

export function NodeReplBody({ input }: ToolCallProps) {
  useLocale()
  const vm = extractNodeRepl(input)
  if (vm.isEmpty) return <JsonFallback input={input} />
  // The title leads as a heading; keep timeout/line-count rows only.
  const rows = vm.title === undefined ? vm.rows : vm.rows.filter((r) => r.labelKey !== FIELDS.title)
  return (
    <div className="mt-1" data-testid="tool-body">
      <p
        className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground"
        data-testid="tool-title"
      >
        {t("toolRenderers.node-repl.title")}
      </p>
      {vm.title !== undefined && (
        <p className="break-words text-xs font-medium" data-testid="node-repl-title">
          {vm.title}
        </p>
      )}
      <FieldRows rows={rows} />
      {vm.code && <CodeBlock text={vm.code.text} maxLines={vm.code.maxLines} />}
    </div>
  )
}
