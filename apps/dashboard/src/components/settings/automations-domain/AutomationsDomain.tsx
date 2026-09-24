// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * AutomationsDomain — management UI over the same /jobs API the jobs
 * panel uses (shared useJobsQueries hooks): list with switch-style
 * enable toggles (LOCAL state — the API has no enabled field yet),
 * create dialog, and delete confirmation dialog.
 */

import { useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useLocale, t } from "@max/i18n"
import { useCreateJob, useDeleteJob, useJobs } from "@/hooks/useJobsQueries"
import {
  EMPTY_AUTOMATION_DRAFT,
  automationSummary,
  filterAutomations,
  toAutomationViews,
  triggerLabelKey,
  validateAutomationDraft,
  type AutomationDraft,
} from "./model"

export function AutomationsDomain() {
  useLocale()
  const qc = useJobs()
  const createJob = useCreateJob()
  const deleteJob = useDeleteJob()

  const [query, setQuery] = useState("")
  const [toggles, setToggles] = useState<Record<string, boolean>>({})
  const [createOpen, setCreateOpen] = useState(false)
  const [draft, setDraft] = useState<AutomationDraft>(EMPTY_AUTOMATION_DRAFT)
  const [draftError, setDraftError] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null)

  const automations = useMemo(() => toAutomationViews(qc.data, toggles), [qc.data, toggles])
  const filtered = useMemo(() => filterAutomations(automations, query), [automations, query])
  const summary = automationSummary(automations)

  const submitDraft = () => {
    const errorKey = validateAutomationDraft(draft)
    if (errorKey !== null) {
      setDraftError(t(errorKey))
      return
    }
    createJob.mutate(
      {
        name: draft.name.trim(),
        schedule: draft.schedule.trim(),
        ...(draft.description.trim() ? { description: draft.description.trim() } : {}),
      },
      {
        onSuccess: () => {
          setDraft(EMPTY_AUTOMATION_DRAFT)
          setDraftError(null)
          setCreateOpen(false)
        },
        onError: (err) => setDraftError(err.message),
      },
    )
  }

  return (
    <Card data-testid="settings-automations">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{t("automations.title")}</CardTitle>
        <p className="text-xs text-muted-foreground">{t("automations.description")}</p>
        {automations.length > 0 && (
          <p className="text-xs text-muted-foreground" data-testid="automations-summary">
            {t("automations.summary")
              .replace("{total}", String(summary.total))
              .replace("{enabled}", String(summary.enabled))
              .replace("{disabled}", String(summary.disabled))}
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {qc.isLoading ? (
          <p className="text-xs text-muted-foreground">{t("automations.state.loading")}</p>
        ) : qc.isError ? (
          <div className="space-y-2">
            <p className="text-xs text-destructive">{t("automations.state.error")}</p>
            <Button size="sm" variant="outline" onClick={() => qc.refetch()}>
              {t("automations.state.retry")}
            </Button>
          </div>
        ) : automations.length === 0 ? (
          <p className="text-xs text-muted-foreground" data-testid="automations-empty">
            {t("automations.state.empty")}
          </p>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("automations.searchPlaceholder")}
                className="h-8 max-w-48 text-xs"
                aria-label={t("automations.searchPlaceholder")}
              />
              <Button size="sm" onClick={() => setCreateOpen(true)} data-testid="automations-new">
                {t("automations.create")}
              </Button>
            </div>
            <ul className="space-y-1" data-testid="automations-list">
              {filtered.map((a) => (
                <li
                  key={a.id}
                  className={`flex flex-wrap items-center justify-between gap-2 rounded border px-2 py-1.5 ${
                    a.enabled ? "" : "opacity-60"
                  }`}
                  data-testid={`automations-row-${a.id}`}
                >
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-xs font-medium">{a.name}</span>
                    <span className="flex flex-wrap items-center gap-1">
                      <Badge variant="secondary" className="h-4 px-1 font-mono text-[10px]">
                        {a.schedule}
                      </Badge>
                      <span className="text-xs text-muted-foreground">{t(triggerLabelKey(a))}</span>
                      <span className="text-xs text-muted-foreground">
                        {t("automations.row.fires")} {a.triggerCount}
                      </span>
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-[10px] text-destructive"
                      onClick={() => setDeleteTarget({ id: a.id, name: a.name })}
                      data-testid={`automations-delete-${a.id}`}
                    >
                      {t("automations.row.delete")}
                    </Button>
                    <Switch
                      checked={a.enabled}
                      onCheckedChange={(checked) => setToggles({ ...toggles, [a.id]: checked })}
                      aria-label={t("automations.row.toggle")}
                      data-testid={`automations-toggle-${a.id}`}
                    />
                  </div>
                </li>
              ))}
            </ul>
            {filtered.length === 0 && (
              <p className="text-xs text-muted-foreground">{t("automations.state.noMatch")}</p>
            )}
          </>
        )}
        <p className="text-[10px] text-muted-foreground">{t("automations.toggleNote")}</p>
      </CardContent>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent data-testid="automations-create-dialog">
          <DialogHeader>
            <DialogTitle>{t("automations.createTitle")}</DialogTitle>
            <DialogDescription>{t("automations.createHint")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="automations-draft-name">{t("automations.form.name")}</Label>
              <Input
                id="automations-draft-name"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="automations-draft-schedule">{t("automations.form.schedule")}</Label>
              <Input
                id="automations-draft-schedule"
                value={draft.schedule}
                onChange={(e) => setDraft({ ...draft, schedule: e.target.value })}
                placeholder="*/5 * * * *"
                className="h-8 font-mono text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="automations-draft-description">
                {t("automations.form.description")}
              </Label>
              <Input
                id="automations-draft-description"
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                className="h-8 text-xs"
              />
            </div>
            {draftError !== null && (
              <p className="text-xs text-destructive" data-testid="automations-draft-error">
                {draftError}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setCreateOpen(false)}>
              {t("automations.form.cancel")}
            </Button>
            <Button
              size="sm"
              onClick={submitDraft}
              disabled={createJob.isPending}
              data-testid="automations-create-submit"
            >
              {t("automations.form.submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      >
        <DialogContent data-testid="automations-delete-dialog">
          <DialogHeader>
            <DialogTitle>{t("automations.deleteTitle")}</DialogTitle>
            <DialogDescription>
              {t("automations.deleteHint").replace("{name}", deleteTarget?.name ?? "")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDeleteTarget(null)}>
              {t("automations.form.cancel")}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={deleteJob.isPending}
              onClick={() => {
                if (deleteTarget === null) return
                deleteJob.mutate(deleteTarget.id, {
                  onSettled: () => setDeleteTarget(null),
                })
              }}
              data-testid="automations-delete-confirm"
            >
              {t("automations.deleteConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
