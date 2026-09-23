// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Settings center v2 (ZCode settings/ borrowing) — one segmented-tab
 * surface over every admin domain instead of three cosmetic toggles:
 *
 *   appearance · language · performance (client)
 *   feature flags · tenants (admin API)
 *   providers health · vault · oracle lessons (system read-only)
 *
 * Each section owns its data via react-query; no section fetches unless
 * mounted.
 */

import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useLocale, t } from "@max/i18n"
import { systemApi, ProviderListResponseSchema } from "@/api"

export type SettingsSectionId =
  | "appearance"
  | "language"
  | "performance"
  | "flags"
  | "tenants"
  | "providers"
  | "vault"
  | "oracle"
  | "subagents"
  | "usageCharts"
  | "store"

export const SETTINGS_SECTIONS: Array<{ id: SettingsSectionId; titleKey: string }> = [
  { id: "appearance", titleKey: "settings.appearance.title" },
  { id: "language", titleKey: "settings.language.title" },
  { id: "performance", titleKey: "settings.performance.title" },
  { id: "flags", titleKey: "settings.flags.title" },
  { id: "tenants", titleKey: "settings.tenants.title" },
  { id: "providers", titleKey: "settings.providersHealth.title" },
  { id: "vault", titleKey: "settings.vault.title" },
  { id: "oracle", titleKey: "settings.oracle.title" },
  { id: "subagents", titleKey: "settingsDeep.subagents.title" },
  { id: "usageCharts", titleKey: "settingsDeep.usage.title" },
  { id: "store", titleKey: "settingsDeep.store.title" },
]

export function SettingsSectionNav({
  active,
  onSelect,
}: {
  active: SettingsSectionId
  onSelect: (id: SettingsSectionId) => void
}) {
  useLocale()
  return (
    <nav className="flex flex-wrap gap-1" data-testid="settings-nav">
      {SETTINGS_SECTIONS.map((s) => (
        <Button
          key={s.id}
          variant={active === s.id ? "default" : "ghost"}
          size="sm"
          onClick={() => onSelect(s.id)}
        >
          {t(s.titleKey)}
        </Button>
      ))}
    </nav>
  )
}

// ── Feature flags ───────────────────────────────────────────────────────────

export function FeatureFlagsSection() {
  useLocale()
  const qc = useQueryClient()
  const [name, setName] = useState("")
  const [value, setValue] = useState("true")
  const { data, isLoading } = useQuery({
    queryKey: ["settings", "flags"],
    queryFn: ({ signal }) => systemApi.listFlags(signal),
  })
  const flags = data?.flags ?? []

  const setOverride = async () => {
    if (!name.trim()) return
    await systemApi.setFlagOverride(name.trim(), value === "true")
    await qc.invalidateQueries({ queryKey: ["settings", "flags"] })
    setName("")
  }

  return (
    <Card data-testid="settings-flags">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{t("settings.flags.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <p className="text-xs text-muted-foreground">{t("common.loading")}</p>
        ) : flags.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("settings.flags.empty")}</p>
        ) : (
          <ul className="space-y-1">
            {flags.map((f) => (
              <li
                key={f.name}
                className="flex items-center justify-between rounded border px-2 py-1.5"
              >
                <span className="font-mono text-xs">{f.name}</span>
                <div className="flex items-center gap-2">
                  {f.description && (
                    <span className="truncate text-xs text-muted-foreground">{f.description}</span>
                  )}
                  <Badge
                    variant={f.enabled ? "default" : "outline"}
                    className="h-4 px-1 text-[10px]"
                  >
                    {String(f.enabled)}
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("settings.flags.namePlaceholder")}
            className="h-8 font-mono text-xs"
            aria-label={t("settings.flags.namePlaceholder")}
          />
          <select
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-label={t("settings.flags.value")}
            className="h-8 rounded-md border border-border bg-background px-2 text-xs"
          >
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
          <Button size="sm" onClick={setOverride}>
            {t("settings.flags.set")}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ── Tenants ─────────────────────────────────────────────────────────────────

export function TenantsSection() {
  useLocale()
  const { data, isLoading } = useQuery({
    queryKey: ["settings", "tenants"],
    queryFn: ({ signal }) => systemApi.listTenants(signal),
  })
  const tenants = data?.items ?? []
  return (
    <Card data-testid="settings-tenants">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{t("settings.tenants.title")}</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-xs text-muted-foreground">{t("common.loading")}</p>
        ) : tenants.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("settings.tenants.empty")}</p>
        ) : (
          <ul className="space-y-1">
            {tenants.map((tenant) => (
              <li
                key={tenant.id}
                className="flex items-center justify-between rounded border px-2 py-1.5"
              >
                <span className="font-mono text-xs">{tenant.id}</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">{tenant.name}</span>
                  <Badge
                    variant={tenant.status === "active" ? "default" : "outline"}
                    className="h-4 px-1 text-[10px]"
                  >
                    {tenant.status}
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

// ── Vault ───────────────────────────────────────────────────────────────────

export function VaultSection() {
  useLocale()
  const { data } = useQuery({
    queryKey: ["settings", "vault"],
    queryFn: ({ signal }) => systemApi.vaultStatus(signal),
    staleTime: 30_000,
  })
  if (!data) return null
  return (
    <Card data-testid="settings-vault">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{t("settings.vault.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-center gap-2">
          <Badge variant={data.configured ? "default" : "outline"} className="h-4 px-1 text-[10px]">
            {data.configured ? t("settings.vault.configured") : t("settings.vault.notConfigured")}
          </Badge>
          {data.configured && !data.open && (
            <Badge variant="destructive" className="h-4 px-1 text-[10px]">
              {t("settings.vault.locked")}
            </Badge>
          )}
        </div>
        {data.path && (
          <p className="break-all font-mono text-xs text-muted-foreground">{data.path}</p>
        )}
        {data.entries.length > 0 && (
          <ul className="space-y-1">
            {data.entries.map((entry) => (
              <li
                key={entry.title}
                className="flex items-center justify-between rounded border px-2 py-1.5"
              >
                <span className="font-mono text-xs">{entry.title}</span>
                {entry.providerPreset && (
                  <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                    {entry.providerPreset}
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

// ── Oracle lessons ──────────────────────────────────────────────────────────

export function OracleLessonsSection() {
  useLocale()
  const { data } = useQuery({
    queryKey: ["settings", "oracle-lessons"],
    queryFn: ({ signal }) => systemApi.oracleLessons(signal),
    staleTime: 60_000,
  })
  if (!data) return null
  return (
    <Card data-testid="settings-oracle">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{t("settings.oracle.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {!data.configured && (
          <p className="text-xs text-muted-foreground">{t("settings.oracle.notConfigured")}</p>
        )}
        {data.lessons.length === 0 && data.configured && (
          <p className="text-xs text-muted-foreground">{t("settings.oracle.empty")}</p>
        )}
        {data.lessons.map((lesson) => (
          <details key={lesson.role} className="rounded border px-2 py-1.5">
            <summary className="cursor-pointer font-mono text-xs">
              {lesson.role} <span className="text-muted-foreground">· {lesson.bytes} B</span>
            </summary>
            <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs text-muted-foreground">
              {lesson.content}
            </pre>
          </details>
        ))}
      </CardContent>
    </Card>
  )
}

/** Providers health section reads the same API the ProviderPanel uses. */
export function ProvidersHealthSection() {
  useLocale()
  const { data } = useQuery({
    queryKey: ["settings", "providers-health"],
    queryFn: ({ signal }) => systemApi.providersHealth(signal),
    staleTime: 30_000,
  })
  const rows = data?.providers ?? []
  return (
    <Card data-testid="settings-providers-health">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{t("settings.providersHealth.title")}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("settings.providersHealth.empty")}</p>
        ) : (
          <ul className="space-y-1">
            {rows.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between rounded border px-2 py-1.5"
              >
                <span className="font-mono text-xs">{p.id}</span>
                <Badge
                  variant={p.configured ? "default" : "outline"}
                  className="h-4 px-1 text-[10px]"
                >
                  {p.configured
                    ? t("settings.providersHealth.ok")
                    : t("settings.providersHealth.unconfigured")}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
