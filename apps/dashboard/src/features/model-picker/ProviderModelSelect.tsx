// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * ProviderModelSelect — pick a configured provider, read its current
 * default model, and promote a same-base-domain preset model to default
 * (deepseek ui-settings-models borrowing: a provider only accepts models
 * served by its own endpoint). Writes through PUT /system/providers/{id}/model
 * via chatApi.setProviderModel with an inline success / failure hint.
 */

import { useEffect, useMemo, useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useLocale, t } from "@max/i18n"
import { chatApi } from "@/api"
import { useProviderPresets } from "@/hooks/useSettingsQueries"
import {
  configurableProviders,
  sameDomainPresets,
  toProviderOptions,
  toPresetCardViews,
  toSetModelResult,
} from "./model"

export function ProviderModelSelect() {
  useLocale()
  const [providerId, setProviderId] = useState("")
  const [model, setModel] = useState("")
  const [applied, setApplied] = useState<string | null>(null)

  const providersQuery = useQuery({
    queryKey: ["model-picker", "providers"],
    queryFn: ({ signal }) => chatApi.listProviders(signal),
    staleTime: 30_000,
  })
  const presetsQuery = useProviderPresets()

  const providers = useMemo(
    () => configurableProviders(toProviderOptions(providersQuery.data)),
    [providersQuery.data],
  )
  const presets = useMemo(() => toPresetCardViews(presetsQuery.data), [presetsQuery.data])
  const candidates = useMemo(() => sameDomainPresets(providerId, presets), [providerId, presets])

  const setModelMutation = useMutation({
    mutationFn: (input: { providerId: string; model: string }) =>
      chatApi.setProviderModel(input.providerId, input.model),
  })

  const selected = providers.find((p) => p.id === providerId)
  const currentModel = applied ?? selected?.defaultModel ?? ""

  // Switching provider resets the draft selection and the last applied
  // result — a stale model id would 400 against the new provider.
  useEffect(() => {
    setModel("")
    setApplied(null)
    setModelMutation.reset()
  }, [providerId])

  const result = setModelMutation.data ? toSetModelResult(setModelMutation.data) : null
  const canApply = providerId !== "" && model !== "" && !setModelMutation.isPending

  const apply = () => {
    if (!canApply) return
    setModelMutation.mutate({ providerId, model }, { onSuccess: () => setApplied(model) })
  }

  return (
    <Card data-testid="model-picker-select">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{t("modelPicker.select.title")}</CardTitle>
        <p className="text-xs text-muted-foreground">{t("modelPicker.select.description")}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {providersQuery.isLoading ? (
          <p className="text-xs text-muted-foreground">{t("modelPicker.loading")}</p>
        ) : providersQuery.isError ? (
          <div className="space-y-2" data-testid="model-picker-select-error">
            <p className="text-xs text-destructive">{t("modelPicker.error")}</p>
            <Button size="sm" variant="outline" onClick={() => providersQuery.refetch()}>
              {t("modelPicker.retry")}
            </Button>
          </div>
        ) : providers.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("modelPicker.select.noConfigured")}</p>
        ) : (
          <>
            <select
              value={providerId}
              onChange={(e) => setProviderId(e.target.value)}
              aria-label={t("modelPicker.select.pickProvider")}
              className="h-8 w-full rounded-md border border-border bg-background px-2 font-mono text-xs"
              data-testid="model-picker-provider-select"
            >
              <option value="">{t("modelPicker.select.pickProvider")}</option>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.id})
                </option>
              ))}
            </select>
            {selected && (
              <p className="text-xs text-muted-foreground" data-testid="model-picker-current">
                {t("modelPicker.select.currentModel")}:{" "}
                <span className="font-mono">{currentModel || "—"}</span>
              </p>
            )}
            {providerId !== "" &&
              (candidates.length === 0 ? (
                <p className="text-xs text-muted-foreground" data-testid="model-picker-no-domain">
                  {t("modelPicker.select.sameDomainEmpty")}
                </p>
              ) : (
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  aria-label={t("modelPicker.select.pickModel")}
                  className="h-8 w-full rounded-md border border-border bg-background px-2 font-mono text-xs"
                  data-testid="model-picker-model-select"
                >
                  <option value="">{t("modelPicker.select.pickModel")}</option>
                  {candidates.map((p) => (
                    <option key={p.id} value={p.defaultModel}>
                      {p.name} — {p.defaultModel}
                    </option>
                  ))}
                </select>
              ))}
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={apply} disabled={!canApply}>
                {setModelMutation.isPending
                  ? t("modelPicker.select.applying")
                  : t("modelPicker.select.apply")}
              </Button>
              {result && result.ok && (
                <Badge variant="default" className="h-4 px-1 text-[10px]">
                  {t("modelPicker.select.success")}
                </Badge>
              )}
              {(setModelMutation.isError || (result && !result.ok)) && (
                <Badge
                  variant="destructive"
                  className="h-4 px-1 text-[10px]"
                  data-testid="model-picker-apply-error"
                >
                  {t("modelPicker.select.failed")}
                </Badge>
              )}
            </div>
            {setModelMutation.isError && (
              <p className="break-all text-xs text-destructive">{setModelMutation.error.message}</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
