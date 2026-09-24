// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * JobsPanel — operational view over the /jobs API: list + create form +
 * delete + manual trigger + per-job pending-slot badge. The v0 executor
 * is record-only (the API stores lastTriggeredAt + an event log), so the
 * trigger button is labeled accordingly — no task dispatch happens yet.
 */

import { useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useLocale, t } from "@max/i18n"
import {
  useCreateJob,
  useDeleteJob,
  useJobSlots,
  useJobs,
  useTriggerJob,
} from "@/hooks/useJobsQueries"
import {
  EMPTY_JOB_DRAFT,
  filterJobs,
  formatIntervalMs,
  formatTimestamp,
  parsePayloadJson,
  sortJobs,
  toJobViews,
  toSlotBadge,
  validateJobDraft,
  windowList,
  type JobSortKey,
} from "./model"

const MAX_VISIBLE = 20

function SlotBadge({ jobId }: { jobId: string }) {
  const { data, isLoading } = useJobSlots(jobId)
  const kind = isLoading ? "unknown" : toSlotBadge(data)
  const labelKey =
    kind === "pending"
      ? "jobs.slot.pending"
      : kind === "idle"
        ? "jobs.slot.idle"
        : "jobs.slot.unknown"
  return (
    <Badge
      variant={kind === "pending" ? "default" : "outline"}
      className="h-4 px-1 text-[10px]"
      data-testid={`jobs-slot-badge-${jobId}`}
    >
      {t(labelKey)}
    </Badge>
  )
}

export function JobsPanel() {
  useLocale()
  const qc = useJobs()
  const createJob = useCreateJob()
  const deleteJob = useDeleteJob()
  const triggerJob = useTriggerJob()

  const [query, setQuery] = useState("")
  const [sortKey, setSortKey] = useState<JobSortKey>("createdAt")
  const [expanded, setExpanded] = useState<string | null>(null)
  const [draft, setDraft] = useState(EMPTY_JOB_DRAFT)
  const [draftError, setDraftError] = useState<string | null>(null)

  const jobs = useMemo(() => toJobViews(qc.data), [qc.data])
  const visible = useMemo(
    () => windowList(sortJobs(filterJobs(jobs, query), sortKey), MAX_VISIBLE),
    [jobs, query, sortKey],
  )

  const draftValidation = validateJobDraft(draft)
  const canSubmit = draftValidation === null && !createJob.isPending

  const submit = () => {
    if (draftValidation !== null) {
      setDraftError(t(draftValidation.key))
      return
    }
    const payload = parsePayloadJson(draft.payloadJson)
    createJob.mutate(
      {
        name: draft.name.trim(),
        schedule: draft.schedule.trim(),
        ...(draft.description.trim() ? { description: draft.description.trim() } : {}),
        ...(payload.ok && payload.value !== undefined ? { payload: payload.value } : {}),
      },
      {
        onSuccess: () => {
          setDraft(EMPTY_JOB_DRAFT)
          setDraftError(null)
        },
        onError: (err) => setDraftError(err.message),
      },
    )
  }

  return (
    <Card data-testid="settings-jobs">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{t("jobs.title")}</CardTitle>
        <p className="text-xs text-muted-foreground">{t("jobs.description")}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {qc.isLoading ? (
          <p className="text-xs text-muted-foreground">{t("jobs.state.loading")}</p>
        ) : qc.isError ? (
          <div className="space-y-2">
            <p className="text-xs text-destructive">{t("jobs.state.error")}</p>
            <Button size="sm" variant="outline" onClick={() => qc.refetch()}>
              {t("jobs.state.retry")}
            </Button>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("jobs.searchPlaceholder")}
                className="h-8 max-w-48 text-xs"
                aria-label={t("jobs.searchPlaceholder")}
              />
              <select
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as JobSortKey)}
                aria-label={t("jobs.sortLabel")}
                className="h-8 rounded-md border border-border bg-background px-2 text-xs"
                data-testid="jobs-sort"
              >
                <option value="createdAt">{t("jobs.sort.createdAt")}</option>
                <option value="name">{t("jobs.sort.name")}</option>
                <option value="nextRunAt">{t("jobs.sort.nextRunAt")}</option>
              </select>
            </div>

            {jobs.length === 0 ? (
              <p className="text-xs text-muted-foreground" data-testid="jobs-empty">
                {t("jobs.state.empty")}
              </p>
            ) : (
              <ul className="space-y-1" data-testid="jobs-list">
                {visible.items.map((j) => {
                  const open = expanded === j.id
                  const interval =
                    j.scheduleKind === "interval" ? formatIntervalMs(j.intervalMs) : null
                  return (
                    <li key={j.id} className="rounded border">
                      <div className="flex flex-wrap items-center justify-between gap-1 px-2 py-1.5">
                        <button
                          type="button"
                          className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-left"
                          onClick={() => setExpanded(open ? null : j.id)}
                          aria-expanded={open}
                        >
                          <span className="truncate text-xs font-medium">{j.name}</span>
                          <Badge variant="secondary" className="h-4 px-1 font-mono text-[10px]">
                            {j.schedule}
                          </Badge>
                          <Badge variant="outline" className="h-4 px-1 text-[10px]">
                            {t(`jobs.kind.${j.scheduleKind}`)}
                            {interval !== null ? ` · ${interval}` : ""}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {t("jobs.row.nextRun")} {formatTimestamp(j.nextRunAt)}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {t("jobs.row.fires")} {j.triggerCount}
                          </span>
                        </button>
                        <span className="flex items-center gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 px-2 text-[10px]"
                            disabled={triggerJob.isPending}
                            onClick={() => triggerJob.mutate(j.id)}
                            data-testid={`jobs-trigger-${j.id}`}
                          >
                            {t("jobs.row.trigger")}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 px-2 text-[10px] text-destructive"
                            disabled={deleteJob.isPending}
                            onClick={() => deleteJob.mutate(j.id)}
                            data-testid={`jobs-delete-${j.id}`}
                          >
                            {t("jobs.row.delete")}
                          </Button>
                        </span>
                      </div>
                      {open && (
                        <div
                          className="space-y-1 border-t px-2 py-1.5"
                          data-testid={`jobs-detail-${j.id}`}
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">
                              {t("jobs.detail.slot")}
                            </span>
                            <SlotBadge jobId={j.id} />
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {t("jobs.detail.lastTriggered")} {formatTimestamp(j.lastTriggeredAt)}
                          </p>
                          {j.description !== null && (
                            <p className="text-xs text-muted-foreground">{j.description}</p>
                          )}
                          <p className="text-xs text-muted-foreground">
                            {t("jobs.detail.payload")}{" "}
                            {j.hasPayload
                              ? t("jobs.detail.payloadPresent")
                              : t("jobs.detail.payloadNone")}
                          </p>
                          {j.lastEvent !== null && (
                            <p className="font-mono text-[10px] text-muted-foreground">
                              {j.lastEvent.kind} · {formatTimestamp(j.lastEvent.at)}
                            </p>
                          )}
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
            {visible.hidden > 0 && (
              <p className="text-xs text-muted-foreground" data-testid="jobs-more">
                {t("jobs.state.showing")
                  .replace("{shown}", String(visible.shown))
                  .replace("{total}", String(visible.total))}
              </p>
            )}
          </>
        )}

        <form
          className="space-y-2 rounded border p-2"
          data-testid="jobs-create"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <p className="text-xs font-medium">{t("jobs.create.title")}</p>
          <div className="flex flex-wrap gap-2">
            <div className="space-y-1">
              <Label className="text-[10px]" htmlFor="jobs-create-name">
                {t("jobs.create.name")}
              </Label>
              <Input
                id="jobs-create-name"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder={t("jobs.create.namePlaceholder")}
                className="h-8 w-40 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px]" htmlFor="jobs-create-schedule">
                {t("jobs.create.schedule")}
              </Label>
              <Input
                id="jobs-create-schedule"
                value={draft.schedule}
                onChange={(e) => setDraft({ ...draft, schedule: e.target.value })}
                placeholder="*/5 * * * *"
                className="h-8 w-40 font-mono text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px]" htmlFor="jobs-create-description">
                {t("jobs.create.description")}
              </Label>
              <Input
                id="jobs-create-description"
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                className="h-8 w-48 text-xs"
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-[10px]" htmlFor="jobs-create-payload">
              {t("jobs.create.payload")}
            </Label>
            <Textarea
              id="jobs-create-payload"
              value={draft.payloadJson}
              onChange={(e) => setDraft({ ...draft, payloadJson: e.target.value })}
              placeholder='{"workspaceId": "ws_1"}'
              className="min-h-16 font-mono text-xs"
            />
          </div>
          {draftError !== null && (
            <p className="text-xs text-destructive" data-testid="jobs-create-error">
              {draftError}
            </p>
          )}
          <Button type="submit" size="sm" disabled={!canSubmit} data-testid="jobs-create-submit">
            {t("jobs.create.submit")}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
