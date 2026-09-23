// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * ProviderModelTester — pick a configured provider, send a one-round chat
 * probe, and read back content + wall-clock duration. The probe is the
 * diagnostic POST /system/providers/{id}/test-chat (read-only in spirit:
 * no settings are changed, one provider call is made).
 */

import { useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { useLocale, t } from "@max/i18n"
import { useProviderPresets, useProviderTestChat } from "@/hooks/useSettingsQueries"
import { testableProviders, toPresetViews, toTestChatView } from "./model"

export function ProviderModelTester() {
  useLocale()
  const [providerId, setProviderId] = useState("")
  const [prompt, setPrompt] = useState("")
  const { data } = useProviderPresets()
  const testChat = useProviderTestChat()

  const configured = useMemo(() => testableProviders(toPresetViews(data)), [data])
  const result = testChat.data ? toTestChatView(testChat.data) : null
  const canRun = providerId !== "" && prompt.trim().length > 0 && !testChat.isPending

  const run = () => {
    if (!canRun) return
    testChat.mutate({ providerId, prompt: prompt.trim() })
  }

  return (
    <Card data-testid="settings-provider-tester">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{t("settingsDeep.tester.title")}</CardTitle>
        <p className="text-xs text-muted-foreground">{t("settingsDeep.tester.description")}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {configured.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("settingsDeep.tester.noConfigured")}</p>
        ) : (
          <>
            <select
              value={providerId}
              onChange={(e) => setProviderId(e.target.value)}
              aria-label={t("settingsDeep.tester.pickProvider")}
              className="h-8 w-full rounded-md border border-border bg-background px-2 font-mono text-xs"
            >
              <option value="">{t("settingsDeep.tester.pickProvider")}</option>
              {configured.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.id})
                </option>
              ))}
            </select>
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={t("settingsDeep.tester.promptPlaceholder")}
              className="min-h-16 text-xs"
              aria-label={t("settingsDeep.tester.promptPlaceholder")}
            />
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={run} disabled={!canRun}>
                {testChat.isPending
                  ? t("settingsDeep.tester.running")
                  : t("settingsDeep.tester.run")}
              </Button>
              {prompt.trim().length === 0 && testChat.isIdle && (
                <span className="text-xs text-muted-foreground">
                  {t("settingsDeep.tester.emptyPrompt")}
                </span>
              )}
            </div>
            {testChat.isError && (
              <div className="rounded border border-destructive/50 p-2" data-testid="tester-error">
                <Badge variant="destructive" className="h-4 px-1 text-[10px]">
                  {t("settingsDeep.tester.failed")}
                </Badge>
                <p className="mt-1 break-all text-xs text-destructive">{testChat.error.message}</p>
              </div>
            )}
            {result && result.ok && (
              <div className="space-y-1 rounded border p-2" data-testid="tester-result">
                <div className="flex flex-wrap items-center gap-1">
                  <span className="text-xs text-muted-foreground">
                    {t("settingsDeep.tester.result")}
                  </span>
                  {result.durationMs !== null && (
                    <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                      {t("settingsDeep.tester.duration").replace("{ms}", String(result.durationMs))}
                    </Badge>
                  )}
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {result.model}
                  </span>
                </div>
                {result.usage && (
                  <p className="text-[10px] text-muted-foreground">
                    {t("settingsDeep.tester.tokens")
                      .replace("{prompt}", String(result.usage.promptTokens))
                      .replace("{completion}", String(result.usage.completionTokens))}
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
