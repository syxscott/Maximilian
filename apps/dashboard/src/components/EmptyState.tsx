// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * EmptyState — onboarding guidance (ZCode GUI borrowing: ChatEmptyState +
 * onboarding flows). Shown where a first-run user would otherwise face a
 * blank panel: describes the three steps to a first run and offers the
 * shortcuts (provider setup, command palette).
 *
 * Step progress lives in onboardingStore (persisted): viewing the card
 * completes "welcome", the provider shortcut completes "connect", the
 * palette shortcut completes "workspace", and "Skip tour" marks the whole
 * tour done. Once the tour is complete the card no longer renders.
 */

import { useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useLocale, t } from "@max/i18n"
import { useOnboardingStore, useOnboardingComplete } from "@/stores/onboardingStore"

export function EmptyState({
  onOpenProviders,
  onOpenPalette,
}: {
  onOpenProviders?: () => void
  onOpenPalette?: () => void
}) {
  useLocale()
  const isComplete = useOnboardingComplete()

  // Landing on the guided card is step one ("welcome") — mark it once per
  // mount; the store dedupes and persists.
  useEffect(() => {
    useOnboardingStore.getState().completeStep("welcome")
  }, [])

  // Tour finished (all steps or skipped) — no more guidance.
  if (isComplete) return null

  const steps = [
    { n: 1, key: "onboarding.step1" },
    { n: 2, key: "onboarding.step2" },
    { n: 3, key: "onboarding.step3" },
  ]
  return (
    <Card className="border-dashed" data-testid="onboarding-empty-state">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">{t("onboarding.title")}</CardTitle>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => useOnboardingStore.getState().skip()}
          data-testid="onboarding-skip"
        >
          {t("shell.onboarding.skip")}
        </Button>
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
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                // Configuring providers is the "connect" step.
                useOnboardingStore.getState().completeStep("connect")
                onOpenProviders()
              }}
              data-testid="onboarding-open-providers"
            >
              {t("onboarding.configureProviders")}
            </Button>
          )}
          {onOpenPalette && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                // Opening the palette to start work is the "workspace" step.
                useOnboardingStore.getState().completeStep("workspace")
                onOpenPalette()
              }}
              data-testid="onboarding-open-palette"
            >
              {t("onboarding.openPalette")}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
