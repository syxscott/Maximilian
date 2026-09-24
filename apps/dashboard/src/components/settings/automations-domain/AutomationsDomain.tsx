// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * AutomationsDomain — management UI over the /jobs API (shared
 * useJobsQueries hooks). Every card IS a real job (`automation:` name
 * prefix): the switch rebuilds the job with an `enabled` payload marker
 * (DELETE + POST — the v0 API has no update route), state is re-derived
 * from GET /jobs, failed toggles roll the optimistic UI back and raise a
 * notification, rows unfold into trigger history (pending-slot state +
 * lastTriggeredAt + a manual "trigger now" button), and the create
 * dialog forces the `automation:` prefix with basic schedule checks
 * (intervalMs or 5-field cron) plus verbatim server error echo.
 */

import { useEffect, useMemo, useRef, useState } from "react"
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
import { useNotificationStore } from "@/stores/notificationStore"
import {
  useCreateJob,
  useDeleteJob,
  useJobSlots,
  useJobs,
  useTriggerJob,
} from "@/hooks/useJobsQueries"
import { formatTimestamp } from "../jobs-domain/model"
import {
  EMPTY_AUTOMATION_DRAFT,
  automationName,
  automationSummary,
  filterAutomations,
  planToggle,
  toAutomationSlotView,
  toAutomationViews,
  triggerLabelKey,
  validateAutomationDraft,
  type AutomationDraft,
  type AutomationView,
} from "./model"

/** Pending-slot badge for one automation's expanded history panel. */
function AutomationSlotBadge({ jobId }: { jobId: string }) {
  const slots = useJobSlots(jobId)
  const view = slots.isLoading
    ? { kind: "unknown" as const, scheduledAt: null }
    : toAutomationSlotView(slots.data)
  const labelKey =
    view.kind === "pending"
      ? "automations.slot.pending"
      : view.kind === "idle"
        ? "automations.slot.idle"
        : "automations.slot.unknown"
  return (
    <Badge
      variant={view.kind === "pending" ? "default" : "outline"}
      className="h-4 px-1 text-[10px]"
      data-testid={`automations-slot-${jobId}`}
    >
      {t(labelKey)}
      {view.scheduledAt !== null ? ` · ${formatTimestamp(view.scheduledAt)}` : ""}
    </Badge>
  )
}

export function AutomationsDomain() {
  useLocale()
  const qc = useJobs()
  const createJob = useCreateJob()
  const deleteJob = useDeleteJob()
  const triggerJob = useTriggerJob()
  const push = useNotificationStore((s) => s.push)

  const [query, setQuery] = useState("")
  /** Optimistic switch state keyed by automation NAME (stable across the
   * delete+rebuild id change); cleared once GET /jobs confirms or the
   * toggle fails. */
  const [pending, setPending] = useState<Record<string, boolean>>({})
  /** Names with a toggle chain in flight — the confirmation effect below
   * must not clear their optimistic state mid-flight. */
  const inFlight = useRef<Set<string>>(new Set())
  const [toggleError, setToggleError] = useState<{ name: string; message: string } | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [draft, setDraft] = useState<AutomationDraft>(EMPTY_AUTOMATION_DRAFT)
  const [draftError, setDraftError] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null)

  const automations = useMemo(() => toAutomationViews(qc.data), [qc.data])
  const filtered = useMemo(() => filterAutomations(automations, query), [automations, query])
  const summary = automationSummary(automations)

  // The server list is the source of truth: once it reflects (or drops)
  // a pending automation, retire the optimistic entry.
  useEffect(() => {
    setPending((prev) => {
      let changed = false
      const next = { ...prev }
      for (const name of Object.keys(next)) {
        if (inFlight.current.has(name)) continue
        const match = automations.find((a) => a.name === name)
        if (match === undefined || match.enabled === next[name]) {
          delete next[name]
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [automations])

  /** Rebuild the job so its payload marker carries the next state. */
  const applyToggle = (a: AutomationView, next: boolean) => {
    const plan = planToggle(a, next)
    if (plan.action === "none") return
    const { deleteId, create, restore } = plan
    inFlight.current.add(a.name)
    setPending((p) => ({ ...p, [a.name]: next }))
    setToggleError(null)

    const settle = () => {
      inFlight.current.delete(a.name)
    }
    const fail = (err: Error) => {
      settle()
      // Roll the optimistic switch back to the server-derived state.
      setPending((p) => {
        if (!(a.name in p)) return p
        const { [a.name]: _drop, ...rest } = p
        return rest
      })
      setToggleError({ name: a.bareName, message: err.message })
      push("error", "automations.notify.toggleFailed", { name: a.bareName })
    }

    deleteJob.mutate(deleteId, {
      onError: fail,
      onSuccess: () => {
        createJob.mutate(create, {
          onSuccess: settle,
          onError: (err) => {
            // Half-applied rebuild: the delete landed, the marker update
            // did not — restore the pre-toggle job, then report failure.
            createJob.mutate(restore, {
              onError: () => {
                push("error", "automations.notify.restoreFailed", { name: a.bareName })
              },
            })
            fail(err)
          },
        })
      },
    })
  }

  const submitDraft = () => {
    const error = validateAutomationDraft(draft)
    if (error !== null) {
      setDraftError(t(error.key))
      return
    }
    createJob.mutate(
      {
        name: automationName(draft.name),
        schedule: draft.schedule.trim(),
        ...(draft.description.trim() ? { description: draft.description.trim() } : {}),
        payload: { enabled: true },
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

  const createDisabled = createJob.isPending || deleteJob.isPending

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
            {automations.length === 0 ? (
              <p className="text-xs text-muted-foreground" data-testid="automations-empty">
                {t("automations.state.empty")}
              </p>
            ) : (
              <ul className="space-y-1" data-testid="automations-list">
                {filtered.map((a) => {
                  const on = pending[a.name] ?? a.enabled
                  const open = expanded === a.id
                  return (
                    <li key={a.id} className="rounded border">
                      <div className="flex flex-wrap items-center justify-between gap-2 px-2 py-1.5">
                        <button
                          type="button"
                          className={`flex min-w-0 flex-1 flex-wrap items-center gap-2 text-left ${
                            on ? "" : "opacity-60"
                          }`}
                          onClick={() => setExpanded(open ? null : a.id)}
                          aria-expanded={open}
                          data-testid={`automations-row-${a.id}`}
                        >
                          <span className="truncate text-xs font-medium">{a.name}</span>
                          <Badge variant="secondary" className="h-4 px-1 font-mono text-[10px]">
                            {a.schedule}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {t(triggerLabelKey(a))}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {t("automations.row.fires")} {a.triggerCount}
                          </span>
                        </button>
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 px-2 text-[10px] text-destructive"
                            disabled={deleteJob.isPending}
                            onClick={() => setDeleteTarget({ id: a.id, name: a.name })}
                            data-testid={`automations-delete-${a.id}`}
                          >
                            {t("automations.row.delete")}
                          </Button>
                          <Switch
                            checked={on}
                            disabled={createDisabled}
                            onCheckedChange={(checked) => applyToggle(a, checked)}
                            aria-label={t("automations.row.toggle")}
                            data-testid={`automations-toggle-${a.id}`}
                          />
                        </div>
                      </div>
                      {open && (
                        <div
                          className="space-y-1 border-t px-2 py-1.5"
                          data-testid={`automations-detail-${a.id}`}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs text-muted-foreground">
                              {t("automations.detail.slot")}
                            </span>
                            <AutomationSlotBadge jobId={a.id} />
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {t("automations.detail.lastTriggered")}{" "}
                            {formatTimestamp(a.lastTriggeredAt)}
                          </p>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 px-2 text-[10px]"
                            disabled={triggerJob.isPending}
                            onClick={() =>
                              triggerJob.mutate(a.id, {
                                onSuccess: () =>
                                  push("success", "automations.notify.triggered", {
                                    name: a.bareName,
                                  }),
                                onError: (err) =>
                                  push("error", "automations.notify.triggerFailed", {
                                    name: a.bareName,
                                    message: err.message,
                                  }),
                              })
                            }
                            data-testid={`automations-trigger-${a.id}`}
                          >
                            {t("automations.row.triggerNow")}
                          </Button>
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
            {automations.length > 0 && filtered.length === 0 && (
              <p className="text-xs text-muted-foreground">{t("automations.state.noMatch")}</p>
            )}
            {toggleError !== null && (
              <p className="text-xs text-destructive" data-testid="automations-toggle-error">
                {t("automations.notify.toggleFailed", { name: toggleError.name })}{" "}
                {toggleError.message}
              </p>
            )}
          </>
        )}
        <p className="text-[10px] text-muted-foreground">{t("automations.toggleNote")}</p>
      </CardContent>

      {/* Create dialog — automation creation IS job creation. */}
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
                placeholder={t("automations.form.namePlaceholder")}
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="automations-draft-schedule">{t("automations.form.schedule")}</Label>
              <Input
                id="automations-draft-schedule"
                value={draft.schedule}
                onChange={(e) => setDraft({ ...draft, schedule: e.target.value })}
                placeholder="*/5 * * * *  |  30000"
                className="h-8 font-mono text-xs"
              />
              <p className="text-[10px] text-muted-foreground">
                {t("automations.form.scheduleHint")}
              </p>
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
