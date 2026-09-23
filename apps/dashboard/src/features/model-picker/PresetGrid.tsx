// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * PresetGrid — the curated provider preset catalog as a card grid (deepseek
 * ui-settings-models borrowing: models are picked from a directory, never
 * typed blind). Category filter chips + search, capped at PRESET_GRID_MAX
 * cards with a folded-remainder footer. Metadata only — the API never
 * returns key material and this grid never asks for it.
 */

import { useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useLocale, t } from "@max/i18n"
import { useProviderPresets } from "@/hooks/useSettingsQueries"
import {
  CATEGORY_FILTER_ALL,
  filterPresetCards,
  presetCategories,
  toPresetCardViews,
  windowCards,
  type PresetCardView,
} from "./model"

function categoryLabel(category: string): string {
  return t(`modelPicker.category.${category}`, category)
}

function PresetCard({ preset }: { preset: PresetCardView }) {
  return (
    <li
      className="flex flex-col gap-1 rounded-md border p-2"
      data-testid={`preset-card-${preset.id}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-xs font-medium">{preset.name}</span>
        <Badge variant="secondary" className="h-4 shrink-0 px-1 text-[10px]">
          {categoryLabel(preset.category)}
        </Badge>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate font-mono text-[10px] text-muted-foreground">
          {preset.defaultModel || "—"}
        </span>
        <Badge
          variant={preset.configured ? "default" : "outline"}
          className="h-4 shrink-0 px-1 text-[10px]"
        >
          {preset.configured ? t("modelPicker.configured") : t("modelPicker.notConfigured")}
        </Badge>
      </div>
    </li>
  )
}

export function PresetGrid() {
  useLocale()
  const [category, setCategory] = useState<string>(CATEGORY_FILTER_ALL)
  const [query, setQuery] = useState("")
  const { data, isLoading, isError, refetch, isFetching } = useProviderPresets()

  const presets = useMemo(() => toPresetCardViews(data), [data])
  const categories = useMemo(() => presetCategories(presets), [presets])
  const filtered = useMemo(
    () => filterPresetCards(presets, category, query),
    [presets, category, query],
  )
  const page = windowCards(filtered)

  return (
    <Card data-testid="model-picker-grid">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{t("modelPicker.grid.title")}</CardTitle>
        <p className="text-xs text-muted-foreground">{t("modelPicker.grid.description")}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <p className="text-xs text-muted-foreground">{t("modelPicker.loading")}</p>
        ) : isError ? (
          <div className="space-y-2" data-testid="model-picker-grid-error">
            <p className="text-xs text-destructive">{t("modelPicker.error")}</p>
            <Button size="sm" variant="outline" onClick={() => refetch()}>
              {t("modelPicker.retry")}
            </Button>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-1" data-testid="model-picker-category-filter">
              <Button
                size="sm"
                variant={category === CATEGORY_FILTER_ALL ? "default" : "ghost"}
                onClick={() => setCategory(CATEGORY_FILTER_ALL)}
              >
                {t("modelPicker.allCategories")}
              </Button>
              {categories.map((c) => (
                <Button
                  key={c}
                  size="sm"
                  variant={category === c ? "default" : "ghost"}
                  onClick={() => setCategory(c)}
                >
                  {categoryLabel(c)}
                </Button>
              ))}
            </div>
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("modelPicker.searchPlaceholder")}
              className="h-8 text-xs"
              aria-label={t("modelPicker.searchPlaceholder")}
            />
            {page.total === 0 ? (
              <p className="text-xs text-muted-foreground">{t("modelPicker.grid.empty")}</p>
            ) : (
              <>
                <ul
                  className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3"
                  data-testid="model-picker-cards"
                >
                  {page.items.map((p) => (
                    <PresetCard key={p.id} preset={p} />
                  ))}
                </ul>
                {page.hidden > 0 && (
                  <p className="text-xs text-muted-foreground" data-testid="model-picker-more">
                    {t("modelPicker.grid.more", { hidden: page.hidden, total: page.total })}
                  </p>
                )}
                {isFetching && (
                  <p className="text-xs text-muted-foreground">{t("modelPicker.loading")}</p>
                )}
              </>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
