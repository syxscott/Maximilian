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
 * notification, rows unfold into a real read-back of the job's trigger
 * history — a structured slots panel (status badge + relative
 * scheduledAt/updatedAt + slot-key tail) and the per-job event log
 * (carried by GET /jobs) as a vertical mini timeline — plus a manual
 * "trigger now" button with a full feedback loop: optimistic spinner →
 * inline success/failure note (auto-dismisses) → slots/lastTriggeredAt
 * refresh via the mutation's query invalidations. The create dialog
 * forces the `automation:` prefix with basic schedule checks (intervalMs
 * or 5-field cron) plus verbatim server error echo.
 */

import { useEffect, useMemo, useRef, useState } from "react"
import { Loader2 } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { TimelineMini } from "@/components/ai-elements/TimelineMini"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { formatRelative, t, useLocale } from "@max/i18n"
import { useNotificationStore } from "@/stores/notificationStore"
import {
  useCreateJob,
  useDeleteJob,
  useJobSlots,
  useJobs,
  useTriggerJob,
} from "@/hooks/useJobsQueries"
import {
  EMPTY_AUTOMATION_DRAFT,
  JOB_EVENT_FILTER_CHIPS,
  TRIGGER_FEEDBACK_MS,
  automationName,
  automationSummary,
  automationTimelineInput,
  filterAutomations,
  filterJobEvents,
  planToggle,
  slotStatusLabelKey,
  toAutomationEventViews,
  toAutomationSlotRows,
  toAutomationViews,
  triggerLabelKey,
  validateAutomationDraft,
  type AutomationDraft,
  type AutomationSlotRow,
  type AutomationView,
  type JobEventKindFilter,
} from "./model"

/** Inline trigger feedback: null = nothing to show. */
interface TriggerFeedback {
  ok: boolean
  message: string | null
}

/** One structured row of the slots panel (status badge + times + key tail). */
function AutomationSlotRowView({ jobId, row }: { jobId: string; row: AutomationSlotRow }) {
  return (
    <div
      className="flex flex-wrap items-center gap-2 text-xs"
      data-testid={`automations-slot-row-${jobId}`}
    >
      <Badge
        variant={row.status === "pending" ? "default" : "outline"}
        className="h-4 px-1 text-[10px]"
        data-testid={`automations-slot-${jobId}`}
      >
        {t(slotStatusLabelKey(row.status))}
      </Badge>
      <span className="font-mono text-[10px] text-muted-foreground">{row.keyTail}</span>
      {row.status === "pending" && (
        <>
          <span className="text-xs text-muted-foreground">
            {t("automations.slots.scheduled")} {row.scheduledAtRelative ?? "—"}
          </span>
          <span className="text-xs text-muted-foreground">
            {t("automations.slots.updated")} {row.updatedAtRelative ?? "—"}
          </span>
        </>
      )}
    </div>
  )
}

/**
 * Expanded row body: slots panel + event-log timeline read back from the
 * server, lastTriggeredAt, and the manual-trigger button with its
 * optimistic pending spinner and inline auto-dismissing feedback.
 */
function AutomationDetail({
  automation: a,
  triggerPending,
  feedback,
  onTrigger,
}: {
  automation: AutomationView
  triggerPending: boolean
  feedback: TriggerFeedback | null
  onTrigger: () => void
}) {
  useLocale()
  const slots = useJobSlots(a.id)
  const slotRows = toAutomationSlotRows(slots.isLoading ? null : slots.data, a.id)
  const allEvents = toAutomationEventViews(a.events)
  /** Kind-chip scope for the history timeline (resets when the row collapses). */
  const [eventFilter, setEventFilter] = useState<JobEventKindFilter>("all")
  const events = filterJobEvents(allEvents, eventFilter)
  return (
    <div className="space-y-2 border-t px-2 py-1.5" data-testid={`automations-detail-${a.id}`}>
      <div className="space-y-1" data-testid={`automations-slots-${a.id}`}>
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {t("automations.slots.title")}
        </p>
        {slotRows.map((row, i) => (
          <AutomationSlotRowView key={i} jobId={a.id} row={row} />
        ))}
      </div>
      <div className="space-y-1" data-testid={`automations-history-${a.id}`}>
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {t("automations.history.title")}
        </p>
        {allEvents.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("automations.history.empty")}</p>
        ) : (
          <>
            <div
              className="flex flex-wrap gap-1"
              role="group"
              aria-label={t("automations.filter.label")}
              data-testid={`automations-event-filter-${a.id}`}
            >
              {JOB_EVENT_FILTER_CHIPS.map((chip) => (
                <button
                  key={chip.kind}
                  type="button"
                  aria-pressed={eventFilter === chip.kind}
                  onClick={() => setEventFilter(chip.kind)}
                  data-testid={`automations-event-chip-${chip.kind}`}
                  className={`rounded-full border px-2 py-0.5 text-[10px] ${
                    eventFilter === chip.kind
                      ? "border-transparent bg-primary text-primary-foreground"
                      : "border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  }`}
                >
                  {t(chip.labelKey)}
                </button>
              ))}
            </div>
            {events.length === 0 ? (
              <p
                className="text-xs text-muted-foreground"
                data-testid={`automations-history-filtered-empty-${a.id}`}
              >
                {t("automations.history.filteredEmpty")}
              </p>
            ) : (
              <div data-testid={`automations-timeline-${a.id}`}>
                <TimelineMini timeline={automationTimelineInput(events, (key) => t(key))} />
              </div>
            )}
          </>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {t("automations.detail.lastTriggered")}{" "}
        {a.lastTriggeredAt !== null ? formatRelative(a.lastTriggeredAt) : "—"}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          className="h-6 px-2 text-[10px]"
          disabled={triggerPending}
          aria-busy={triggerPending}
          onClick={onTrigger}
          data-testid={`automations-trigger-${a.id}`}
        >
          {triggerPending && (
            <Loader2
              aria-hidden="true"
              className="mr-1 h-3 w-3 animate-spin"
              data-testid={`automations-trigger-spinner-${a.id}`}
            />
          )}
          {t(triggerPending ? "automations.row.triggering" : "automations.row.triggerNow")}
        </Button>
        {feedback !== null && (
          <span
            role="status"
            className={`text-xs ${feedback.ok ? "text-emerald-600" : "text-destructive"}`}
            data-testid={`automations-trigger-feedback-${a.id}`}
          >
            {feedback.ok
              ? t("automations.feedback.success", { name: a.bareName })
              : `${t("automations.feedback.failure")} ${feedback.message ?? ""}`}
          </span>
        )}
      </div>
    </div>
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
  /** Automation ids with a manual trigger in flight (per-row spinner). */
  const [triggerPending, setTriggerPending] = useState<Record<string, true>>({})
  /** Inline trigger feedback keyed by automation id; auto-dismisses. */
  const [triggerFeedback, setTriggerFeedback] = useState<Record<string, TriggerFeedback>>({})
  const feedbackTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  useEffect(() => {
    const timers = feedbackTimers.current
    return () => {
      for (const timer of timers.values()) clearTimeout(timer)
    }
  }, [])
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

  /** Drop one automation's inline feedback (and its pending timer). */
  const dropTriggerFeedback = (id: string) => {
    const timer = feedbackTimers.current.get(id)
    if (timer !== undefined) {
      clearTimeout(timer)
      feedbackTimers.current.delete(id)
    }
    setTriggerFeedback((p) => {
      if (!(id in p)) return p
      const { [id]: _drop, ...rest } = p
      return rest
    })
  }

  /** Feedback loop settle: spinner off, inline note on, auto-dismiss armed. */
  const settleTrigger = (id: string, ok: boolean, message: string | null) => {
    setTriggerPending((p) => {
      if (!(id in p)) return p
      const { [id]: _drop, ...rest } = p
      return rest
    })
    setTriggerFeedback((p) => ({ ...p, [id]: { ok, message } }))
    const prev = feedbackTimers.current.get(id)
    if (prev !== undefined) clearTimeout(prev)
    feedbackTimers.current.set(
      id,
      setTimeout(() => {
        feedbackTimers.current.delete(id)
        setTriggerFeedback((p) => {
          if (!(id in p)) return p
          const { [id]: _drop, ...rest } = p
          return rest
        })
      }, TRIGGER_FEEDBACK_MS),
    )
  }

  /** Manual trigger: optimistic per-row spinner, then inline feedback;
   * the mutation's onSuccess invalidations refresh slots + the list
   * (lastTriggeredAt) read-back. */
  const requestTrigger = (a: AutomationView) => {
    dropTriggerFeedback(a.id)
    setTriggerPending((p) => ({ ...p, [a.id]: true }))
    triggerJob.mutate(a.id, {
      onSuccess: () => settleTrigger(a.id, true, null),
      onError: (err) => settleTrigger(a.id, false, err.message),
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
                        <AutomationDetail
                          automation={a}
                          triggerPending={triggerPending[a.id] === true}
                          feedback={triggerFeedback[a.id] ?? null}
                          onTrigger={() => requestTrigger(a)}
                        />
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
