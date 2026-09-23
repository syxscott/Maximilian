// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * PresetCatalogBrowser — full management surface over the curated provider
 * preset database (ZCode settings/providers borrowing): category filter,
 * search, capped list with expandable metadata rows. Metadata only — the
 * API never returns key material, and this component never asks for it.
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
  filterPresets,
  presetCategories,
  toPresetViews,
  windowList,
} from "./model"

const MAX_VISIBLE = 50

export function PresetCatalogBrowser() {
  useLocale()
  const [category, setCategory] = useState<string>(CATEGORY_FILTER_ALL)
  const [query, setQuery] = useState("")
  const [expanded, setExpanded] = useState<string | null>(null)
  const { data, isLoading, isError, refetch, isFetching } = useProviderPresets()

  const presets = useMemo(() => toPresetViews(data), [data])
  const categories = useMemo(() => presetCategories(presets), [presets])
  const filtered = useMemo(
    () => filterPresets(presets, category, query),
    [presets, category, query],
  )
  const page = windowList(filtered, MAX_VISIBLE)

  return (
    <Card data-testid="settings-providers-catalog">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{t("settingsDeep.providers.title")}</CardTitle>
        <p className="text-xs text-muted-foreground">{t("settingsDeep.providers.description")}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <p className="text-xs text-muted-foreground">{t("settingsDeep.common.loading")}</p>
        ) : isError ? (
          <div className="space-y-2">
            <p className="text-xs text-destructive">{t("settingsDeep.common.error")}</p>
            <Button size="sm" variant="outline" onClick={() => refetch()}>
              {t("settingsDeep.common.retry")}
            </Button>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-1" data-testid="providers-category-filter">
              <Button
                size="sm"
                variant={category === CATEGORY_FILTER_ALL ? "default" : "ghost"}
                onClick={() => setCategory(CATEGORY_FILTER_ALL)}
              >
                {t("settingsDeep.providers.allCategories")}
              </Button>
              {categories.map((c) => (
                <Button
                  key={c}
                  size="sm"
                  variant={category === c ? "default" : "ghost"}
                  onClick={() => setCategory(c)}
                >
                  {t(`settingsDeep.providers.category.${c}`)}
                </Button>
              ))}
            </div>
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("settingsDeep.providers.searchPlaceholder")}
              className="h-8 text-xs"
              aria-label={t("settingsDeep.providers.searchPlaceholder")}
            />
            {page.total === 0 ? (
              <p className="text-xs text-muted-foreground">{t("settingsDeep.providers.empty")}</p>
            ) : (
              <>
                <ul className="space-y-1" data-testid="providers-catalog-list">
                  {page.items.map((p) => {
                    const open = expanded === p.id
                    return (
                      <li key={p.id} className="rounded border">
                        <button
                          type="button"
                          className="flex w-full items-center justify-between px-2 py-1.5 text-left"
                          onClick={() => setExpanded(open ? null : p.id)}
                          aria-expanded={open}
                        >
                          <span className="min-w-0 truncate font-mono text-xs">{p.name}</span>
                          <span className="ml-2 flex shrink-0 items-center gap-1">
                            <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                              {t(`settingsDeep.providers.category.${p.category}`)}
                            </Badge>
                            <Badge
                              variant={p.configured ? "default" : "outline"}
                              className="h-4 px-1 text-[10px]"
                            >
                              {p.configured
                                ? t("settingsDeep.providers.configured")
                                : t("settingsDeep.providers.notConfigured")}
                            </Badge>
                            <span className="text-xs text-muted-foreground">{p.defaultModel}</span>
                          </span>
                        </button>
                        {open && (
                          <dl
                            className="space-y-1 border-t px-2 py-1.5 text-xs"
                            data-testid={`providers-detail-${p.id}`}
                          >
                            <div className="flex justify-between gap-2">
                              <dt className="text-muted-foreground">id</dt>
                              <dd className="font-mono">{p.id}</dd>
                            </div>
                            <div className="flex justify-between gap-2">
                              <dt className="text-muted-foreground">
                                {t("settingsDeep.providers.field.apiFormat")}
                              </dt>
                              <dd className="font-mono">{p.apiFormat}</dd>
                            </div>
                            <div className="flex justify-between gap-2">
                              <dt className="text-muted-foreground">
                                {t("settingsDeep.providers.field.baseUrl")}
                              </dt>
                              <dd className="break-all font-mono">{p.baseUrl}</dd>
                            </div>
                            <div className="flex justify-between gap-2">
                              <dt className="text-muted-foreground">
                                {t("settingsDeep.providers.field.envKey")}
                              </dt>
                              <dd className="font-mono">{p.envKey}</dd>
                            </div>
                            {p.envModel && (
                              <div className="flex justify-between gap-2">
                                <dt className="text-muted-foreground">
                                  {t("settingsDeep.providers.field.envModel")}
                                </dt>
                                <dd className="font-mono">{p.envModel}</dd>
                              </div>
                            )}
                          </dl>
                        )}
                      </li>
                    )
                  })}
                </ul>
                {page.hidden > 0 && (
                  <p className="text-xs text-muted-foreground" data-testid="providers-catalog-more">
                    {t("settingsDeep.common.showing")
                      .replace("{shown}", String(page.shown))
                      .replace("{total}", String(page.total))}
                  </p>
                )}
                {isFetching && (
                  <p className="text-xs text-muted-foreground">
                    {t("settingsDeep.common.loading")}
                  </p>
                )}
              </>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
