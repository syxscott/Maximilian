// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * EmptyState — onboarding guidance (ZCode GUI borrowing: ChatEmptyState +
 * onboarding flows). Shown where a first-run user would otherwise face a
 * blank panel: describes the three steps to a first run and offers the
 * shortcuts (provider setup, command palette).
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useLocale, t } from "@max/i18n"

export function EmptyState({
  onOpenProviders,
  onOpenPalette,
}: {
  onOpenProviders?: () => void
  onOpenPalette?: () => void
}) {
  useLocale()
  const steps = [
    { n: 1, key: "onboarding.step1" },
    { n: 2, key: "onboarding.step2" },
    { n: 3, key: "onboarding.step3" },
  ]
  return (
    <Card className="border-dashed" data-testid="onboarding-empty-state">
      <CardHeader>
        <CardTitle className="text-base">{t("onboarding.title")}</CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="space-y-2 text-sm text-muted-foreground">
          {steps.map((s) => (
            <li key={s.n} className="flex items-start gap-2">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border text-xs font-medium">
                {s.n}
              </span>
              <span>{t(s.key)}</span>
            </li>
          ))}
        </ol>
        <div className="mt-4 flex gap-2">
          {onOpenProviders && (
            <Button size="sm" variant="secondary" onClick={onOpenProviders}>
              {t("onboarding.configureProviders")}
            </Button>
          )}
          {onOpenPalette && (
            <Button size="sm" variant="ghost" onClick={onOpenPalette}>
              {t("onboarding.openPalette")}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
