// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * list-models renderer — model discovery. The real call usually carries no
 * arguments, so the body has an explicit, localized empty state ("discovery
 * request — server returns the configured model list") instead of a bare
 * fallback; provider/reasoning-level filters and model counts render as
 * rows when the payload carries them.
 */

import { useLocale, t } from "@max/i18n"
import type { ToolCallProps } from "../registry"
import { FieldRows, JsonFallback } from "./common"
import { extractListModels } from "./coordination.model"

export const LIST_MODELS_GLYPH = "☰"

export function ListModelsBody({ input }: ToolCallProps) {
  useLocale()
  const vm = extractListModels(input)
  if (vm.isEmpty) {
    return (
      <div className="mt-1" data-testid="tool-body">
        <p
          className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground"
          data-testid="tool-title"
        >
          {t("toolRenderers.list-models.title")}
        </p>
        <p className="text-xs text-muted-foreground" data-testid="list-models-empty">
          {t("toolRenderers.listModels.noFilters")}
        </p>
        <JsonFallback input={input} />
      </div>
    )
  }
  return (
    <div className="mt-1" data-testid="tool-body">
      <p
        className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground"
        data-testid="tool-title"
      >
        {t("toolRenderers.list-models.title")}
      </p>
      <FieldRows rows={vm.rows} />
    </div>
  )
}
