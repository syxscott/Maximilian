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

import { useEffect, useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useLocale, t } from "@max/i18n"
import { systemApi, ProviderListResponseSchema } from "@/api"
import { featureDomain } from "@/features"
import { useJobs } from "@/hooks/useJobsQueries"
import { useJobsStore } from "@/stores/jobsStore"
import { useNotificationStore } from "@/stores/notificationStore"
import type { SettingsSection } from "@/stores/settingsUiStore"
import { JobsPanel } from "./jobs-domain/JobsPanel"
import { AutomationsDomain } from "./automations-domain/AutomationsDomain"
import { MemoryDomain } from "./memory-domain/MemoryDomain"
import { SkillsDomain } from "./skills-domain/SkillsDomain"

/**
 * Section ids come from the settings-center store (the canonical shell
 * list — see stores/settingsUiStore.ts). Typing the nav entries with it
 * makes a nav/store drift a compile error instead of a silent dead
 * section.
 */
export type SettingsSectionId = SettingsSection

/**
 * The settings nav is derived from FEATURE_DOMAINS (src/features — the
 * single registry, the section field marks the admin/observe/workspace
 * attribution). Each row of this bridge names the store-pinned shell
 * section id and the FEATURE_DOMAINS entries it surfaces, by id or
 * alias; the nav label derives from the primary domain's titleKey
 * unless the settings surface has its own label. Nothing here may
 * introduce a domain the registry does not know — the linkage is
 * locked by test/registry-unification.test.ts (every section resolves,
 * every admin domain is surfaced).
 */
export const SETTINGS_SECTION_DOMAINS: ReadonlyArray<{
  id: SettingsSectionId
  /** FEATURE_DOMAINS ids this section surfaces (first = label donor). */
  domains: readonly string[]
  /** Nav tooltip describing the section (deep i18n key). */
  descriptionKey: string
  /** Settings-surface label when it differs from the domain's title. */
  titleKey?: string
}> = [
  // Client preferences — the settings domain's client page, which also
  // hosts the permissions matrix below the theme card.
  {
    id: "appearance",
    domains: ["settings", "permissions"],
    titleKey: "settings.appearance.title",
    descriptionKey: "settings.appearance.description",
  },
  {
    id: "language",
    domains: ["settings"],
    titleKey: "settings.language.title",
    descriptionKey: "settings.language.description",
  },
  {
    id: "performance",
    domains: ["settings"],
    titleKey: "settings.performance.title",
    descriptionKey: "settings.performance.description",
  },
  // Admin API surfaces — governance domain, section-local labels.
  {
    id: "flags",
    domains: ["governance"],
    titleKey: "settings.flags.title",
    descriptionKey: "settings.flags.description",
  },
  {
    id: "tenants",
    domains: ["governance"],
    titleKey: "settings.tenants.title",
    descriptionKey: "settings.tenants.description",
  },
  // Providers health plus the model-picker catalog (preset grid and
  // connectivity probe) — the model-picker domain's admin home.
  {
    id: "providers",
    domains: ["providers", "model-picker"],
    titleKey: "settings.providersHealth.title",
    descriptionKey: "settings.providersHealth.description",
  },
  { id: "vault", domains: ["vault"], descriptionKey: "settings.vault.description" },
  {
    id: "oracle",
    domains: ["oracle-triad"],
    titleKey: "settings.oracle.title",
    descriptionKey: "settings.oracle.description",
  },
  {
    id: "subagents",
    domains: ["subagents"],
    titleKey: "settingsDeep.subagents.title",
    descriptionKey: "settingsDeep.subagents.description",
  },
  {
    id: "usageCharts",
    domains: ["usage"],
    titleKey: "settingsDeep.usage.title",
    descriptionKey: "settingsDeep.usage.description",
  },
  // Session store status + migrations — the sessions domain's admin view.
  {
    id: "store",
    domains: ["sessions"],
    titleKey: "settingsDeep.store.title",
    descriptionKey: "settingsDeep.store.description",
  },
  // Same-id domains: the label derives straight from the registry.
  { id: "automations", domains: ["automations"], descriptionKey: "automations.description" },
  { id: "jobs", domains: ["jobs"], descriptionKey: "jobs.description" },
  { id: "memory", domains: ["memory"], descriptionKey: "memory.description" },
  { id: "skills", domains: ["skills"], descriptionKey: "skills.description" },
]

export const SETTINGS_SECTIONS: Array<{
  id: SettingsSectionId
  titleKey: string
  /** Nav tooltip describing the section (deep i18n key). */
  descriptionKey: string
  /** FEATURE_DOMAINS ids this section surfaces (registry linkage). */
  domains: readonly string[]
}> = SETTINGS_SECTION_DOMAINS.map(({ id, domains, descriptionKey, titleKey }) => ({
  id,
  domains,
  descriptionKey,
  titleKey: titleKey ?? featureDomain(domains[0])?.titleKey ?? domains[0],
}))

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
          title={t(s.descriptionKey)}
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

// ── Jobs section (jobsStore bridge) ─────────────────────────────────────────

/**
 * Jobs section = the jobs-domain JobsPanel plus the store wiring around
 * it: the react-query snapshot is injected into jobsStore (setJobs, the
 * store's only write path) and the store's live state is read back into
 * a summary strip, so the shared jobs store is genuinely consumed. A job
 * id that appears for the first time (i.e. was just created) fires a
 * notification-store push — the ToastHost surfaces it.
 */
export function JobsDomainSection({
  onOpenWorkspace,
  activeWorkspaceId,
}: {
  /** Bridge to the App's pickWorkspace (materialized-workspace chips). */
  onOpenWorkspace?: (workspaceId: string) => void
  activeWorkspaceId?: string
}) {
  useLocale()
  const jobsQuery = useJobs()
  const setJobs = useJobsStore((s) => s.setJobs)
  const jobs = useJobsStore((s) => s.jobs)

  useEffect(() => {
    // Inject the fresh snapshot; parseJobs drops malformed entries.
    setJobs(jobsQuery.data)
  }, [jobsQuery.data, setJobs])

  // Notify on newly created jobs: an id we have not seen in any previous
  // snapshot means a create (or an external writer) landed.
  const seenIdsRef = useRef<Set<string> | null>(null)
  useEffect(() => {
    const rows = jobsQuery.data?.jobs ?? []
    if (seenIdsRef.current === null) {
      seenIdsRef.current = new Set(rows.map((j) => j.id))
      return
    }
    const seen = seenIdsRef.current
    for (const row of rows) {
      if (!seen.has(row.id)) {
        useNotificationStore.getState().push("success", "shell.notify.jobCreated", {
          name: row.name,
        })
      }
    }
    seenIdsRef.current = new Set(rows.map((j) => j.id))
  }, [jobsQuery.data])

  const running = jobs.filter((j) => j.state === "running").length
  const failed = jobs.filter((j) => j.state === "failed").length

  return (
    <div className="space-y-3" data-testid="settings-jobs-section">
      <p className="text-xs text-muted-foreground" data-testid="jobs-store-summary">
        {t("stores.jobs.title")}: {jobs.length} · {t("stores.jobs.stateRunning")} {running} ·{" "}
        {t("stores.jobs.stateFailed")} {failed}
      </p>
      <JobsPanel onOpenWorkspace={onOpenWorkspace} activeWorkspaceId={activeWorkspaceId} />
    </div>
  )
}
