// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * ModelTestPanel — one-round chat probe against a configured provider
 * (deepseek ui-settings-models borrowing: a key is only "working" once a
 * round-trip came back). Sends the prompt via the diagnostic
 * POST /system/providers/{id}/test-chat and renders the wall-clock
 * duration badge next to the returned content. Read-only in spirit: no
 * settings change, one provider call per run.
 */

import { useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { useLocale, t } from "@max/i18n"
import { useProviderPresets, useProviderTestChat } from "@/hooks/useSettingsQueries"
import { durationTone, toPresetCardViews, toTestChatCardView, type DurationTone } from "./model"

const TONE_CLASS: Record<DurationTone, string> = {
  fast: "",
  slow: "text-amber-600 dark:text-amber-400",
  unknown: "text-muted-foreground",
}

export function ModelTestPanel() {
  useLocale()
  const [providerId, setProviderId] = useState("")
  const [prompt, setPrompt] = useState("")
  const { data } = useProviderPresets()
  const testChat = useProviderTestChat()

  const configured = useMemo(() => toPresetCardViews(data).filter((p) => p.configured), [data])
  const result = testChat.data ? toTestChatCardView(testChat.data) : null
  const tone = durationTone(result?.durationMs ?? null)
  const canRun = providerId !== "" && prompt.trim().length > 0 && !testChat.isPending

  const run = () => {
    if (!canRun) return
    testChat.mutate({ providerId, prompt: prompt.trim() })
  }

  return (
    <Card data-testid="model-picker-test">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{t("modelPicker.test.title")}</CardTitle>
        <p className="text-xs text-muted-foreground">{t("modelPicker.test.description")}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {configured.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("modelPicker.test.noConfigured")}</p>
        ) : (
          <>
            <select
              value={providerId}
              onChange={(e) => setProviderId(e.target.value)}
              aria-label={t("modelPicker.test.pickProvider")}
              className="h-8 w-full rounded-md border border-border bg-background px-2 font-mono text-xs"
            >
              <option value="">{t("modelPicker.test.pickProvider")}</option>
              {configured.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.id})
                </option>
              ))}
            </select>
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={t("modelPicker.test.promptPlaceholder")}
              className="min-h-16 text-xs"
              aria-label={t("modelPicker.test.promptPlaceholder")}
            />
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={run} disabled={!canRun}>
                {testChat.isPending ? t("modelPicker.test.running") : t("modelPicker.test.run")}
              </Button>
              {prompt.trim().length === 0 && testChat.isIdle && (
                <span className="text-xs text-muted-foreground">
                  {t("modelPicker.test.emptyPrompt")}
                </span>
              )}
            </div>
            {testChat.isError && (
              <div
                className="rounded border border-destructive/50 p-2"
                data-testid="model-picker-test-error"
              >
                <Badge variant="destructive" className="h-4 px-1 text-[10px]">
                  {t("modelPicker.test.failed")}
                </Badge>
                <p className="mt-1 break-all text-xs text-destructive">{testChat.error.message}</p>
              </div>
            )}
            {result && result.ok && (
              <div className="space-y-1 rounded border p-2" data-testid="model-picker-test-result">
                <div className="flex flex-wrap items-center gap-1">
                  <span className="text-xs text-muted-foreground">
                    {t("modelPicker.test.result")}
                  </span>
                  {result.durationMs !== null && (
                    <Badge
                      variant="secondary"
                      className={`h-4 px-1 text-[10px] ${TONE_CLASS[tone]}`}
                    >
                      {t("modelPicker.test.durationMs", { ms: result.durationMs })}
                    </Badge>
                  )}
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {result.model}
                  </span>
                </div>
                {result.usage && (
                  <p className="text-[10px] text-muted-foreground">
                    {t("modelPicker.test.tokens", {
                      prompt: result.usage.promptTokens,
                      completion: result.usage.completionTokens,
                    })}
                  </p>
                )}
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs">
                  {result.content}
                </pre>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
