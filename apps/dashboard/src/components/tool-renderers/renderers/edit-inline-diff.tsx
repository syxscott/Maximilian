// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * EditInlineDiff — the body shared by the edit/write renderers: file path
 * rows plus, for edit, an inline line-colored diff reused from
 * DiffPreview (extractChange); write output is plain text, so it mounts
 * the ai-elements DocumentPreviewBlock (line-counted, expandable) over
 * the written content instead. Falls back to the generic JSON preview
 * when the input carries neither a change pair nor a path.
 */

import { useLocale, t } from "@max/i18n"
import { DiffPreview } from "@/components/_helpers/DiffPreview"
import { DocumentPreviewBlock } from "@/components/ai-elements"
import type { ToolCallProps } from "../registry"
import { extractFileChange } from "./edit-inline-diff.model"
import { FieldRows, JsonFallback } from "./common"
import { asRecord, pickStr } from "./shared.model"

export const EDIT_INLINE_DIFF_MAX_LINES = 16

export function EditInlineDiffBody({ tool, input }: ToolCallProps) {
  useLocale()
  const vm = extractFileChange(tool, input)
  if (vm.isEmpty) return <JsonFallback input={input} />
  const writeContent =
    tool === "write" ? pickStr(asRecord(input), ["newString", "content"]) : undefined
  return (
    <div className="mt-1" data-testid="tool-body">
      <p
        className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground"
        data-testid="tool-title"
      >
        {t(`toolRenderers.${tool}.title`)}
      </p>
      <FieldRows rows={vm.rows} />
      {writeContent !== undefined ? (
        <DocumentPreviewBlock text={writeContent} visibleLines={EDIT_INLINE_DIFF_MAX_LINES} />
      ) : (
        <DiffPreview tool={tool} input={input} maxLines={EDIT_INLINE_DIFF_MAX_LINES} />
      )}
    </div>
  )
}
