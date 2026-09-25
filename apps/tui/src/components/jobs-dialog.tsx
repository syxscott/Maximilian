import React, { useEffect, useRef, useState } from "react"
import { t } from "@max/i18n"
import { Box, Text, useInput } from "ink"
import Spinner from "ink-spinner"

import type { Job } from "../api"
import { useSDK } from "../context/sdk"
import { useToast } from "./toast"
import { useJobs, deleteJobViaSdk, triggerJobViaSdk } from "../hooks/useJobs"
import {
  elapsedSeconds,
  formatJobEvent,
  formatRelativeTime,
  formatSchedule,
  jobDetailEvents,
  jobEventKindLabel,
  jobStatusView,
  payloadKind,
  payloadLabelKey,
  relativeTime,
  scheduleEstimate,
  type RelativeTime,
} from "./jobs-model"
import "../locales/tui-panels"

/**
 * Jobs dialog — the TUI face of GET /api/jobs (the dashboard's jobs card,
 * ported to ink and the existing dialog-* patterns). Navigation is j/k,
 * Enter expands the selected job's detail (schedule estimate + payload kind
 * + the last 5 trigger-history events with localized kinds and relative
 * times), d deletes (two-press confirm, the dialog-workspace-list pattern),
 * t fires a manual trigger, r refreshes (a live "updated Ns ago" hint keeps
 * the cadence visible). Success/failure surfaces through the existing toast.
 */
export function JobsDialog() {
  const sdk = useSDK()
  const toast = useToast()
  const { jobs, total, isError, isLoading, error, refresh } = useJobs()
  const [cursor, setCursor] = useState(0)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // 1s heartbeat so the refresh hint ages without waiting for a keypress.
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [])
  // Freeze "now" per data load so all relative timestamps age consistently
  // within one render pass (and tests / screenshots stay deterministic).
  const nowRef = useRef(Date.now())
  const loadedOnceRef = useRef(false)
  if (!isLoading) loadedOnceRef.current = true

  const maxCursor = Math.max(0, jobs.length - 1)
  const safeCursor = Math.min(cursor, maxCursor)
  const selected = jobs.length > 0 ? jobs[safeCursor] : undefined

  async function performDelete(job: Job) {
    if (busy) return
    setBusy(true)
    try {
      await deleteJobViaSdk(sdk.client, job.id)
      toast.show({
        variant: "success",
        message: t("tui.jobs.deleted", { name: job.name }, `Job ${job.name} deleted`),
        duration: 2000,
      })
      setExpandedId((prev) => (prev === job.id ? null : prev))
      nowRef.current = Date.now()
      refresh()
    } catch (err) {
      toast.show({
        variant: "error",
        message: t(
          "tui.jobs.deleteFailed",
          { error: err instanceof Error ? err.message : String(err) },
          `Delete failed: ${err instanceof Error ? err.message : String(err)}`,
        ),
        duration: 4000,
      })
    } finally {
      setBusy(false)
    }
  }

  async function performTrigger(job: Job) {
    if (busy) return
    setBusy(true)
    try {
      await triggerJobViaSdk(sdk.client, job.id)
      toast.show({
        variant: "success",
        message: t("tui.jobs.triggered", { name: job.name }, `Job ${job.name} triggered`),
        duration: 2000,
      })
      nowRef.current = Date.now()
      refresh()
    } catch (err) {
      toast.show({
        variant: "error",
        message: t(
          "tui.jobs.triggerFailed",
          { error: err instanceof Error ? err.message : String(err) },
          `Trigger failed: ${err instanceof Error ? err.message : String(err)}`,
        ),
        duration: 4000,
      })
    } finally {
      setBusy(false)
    }
  }

  useInput((input, key) => {
    if (key.upArrow || input === "k") {
      setConfirmDeleteId(null)
      setCursor((prev) => Math.max(0, Math.min(prev, maxCursor) - 1))
      return
    }
    if (key.downArrow || input === "j") {
      setConfirmDeleteId(null)
      setCursor((prev) => Math.min(maxCursor, Math.min(prev, maxCursor) + 1))
      return
    }
    if (key.return) {
      if (selected) setExpandedId((prev) => (prev === selected.id ? null : selected.id))
      return
    }
    if (input === "r") {
      nowRef.current = Date.now()
      refresh()
      return
    }
    if (input === "d" && selected) {
      if (confirmDeleteId === selected.id) {
        setConfirmDeleteId(null)
        void performDelete(selected)
      } else {
        setConfirmDeleteId(selected.id)
      }
      return
    }
    if (input === "t" && selected) {
      setConfirmDeleteId(null)
      void performTrigger(selected)
      return
    }
    // Any other key disarms the delete confirm (matches dialog-workspace-list).
    if (confirmDeleteId !== null) setConfirmDeleteId(null)
  })

  const now = nowRef.current

  return (
    <Box flexDirection="column" paddingLeft={1} paddingRight={1}>
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold>
          {t("tui.jobs", "Jobs")}
          {total > 0 ? ` (${total})` : ""}
        </Text>
        <Text dimColor>esc</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        {isLoading && !loadedOnceRef.current ? (
          <Text color="gray">
            <Spinner type="dots" /> {t("tui.jobs.loading", "Loading jobs…")}
          </Text>
        ) : isError ? (
          <Text color="red">
            {t("tui.jobs.error", { error: error ?? "" }, `Failed to load jobs: ${error ?? ""}`)}
          </Text>
        ) : jobs.length === 0 ? (
          <Text color="gray">{t("tui.jobs.empty", "No scheduled jobs.")}</Text>
        ) : (
          jobs.map((job, index) => (
            <JobRow
              key={job.id}
              job={job}
              selected={index === safeCursor}
              expanded={expandedId === job.id}
              confirmingDelete={confirmDeleteId === job.id}
              now={now}
            />
          ))
        )}
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>
          {t(
            "tui.jobs.hints",
            "j/k move · Enter details · d delete · t trigger · r refresh · esc close",
          )}
        </Text>
        {(() => {
          const age = elapsedSeconds(now, Date.now())
          return age !== null ? (
            <Text dimColor>
              {t("tui.jobs.refreshAgo", { seconds: age }, `updated ${age}s ago · r refresh`)}
            </Text>
          ) : null
        })()}
      </Box>
    </Box>
  )
}

function JobRow(props: {
  job: Job
  selected: boolean
  expanded: boolean
  confirmingDelete: boolean
  now: number
}) {
  const { job, selected, expanded, confirmingDelete, now } = props
  const status = jobStatusView(job)
  const last = formatRelativeTime(
    relativeTime(job.lastTriggeredAt, now),
    t("tui.jobs.never", "never"),
  )
  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <Text> </Text>
        <Text color={selected ? "green" : undefined}>{selected ? "❯" : " "}</Text>
        <Text color={status.color}>{status.color === "gray" ? "○" : "●"} </Text>
        <Text color={selected ? "green" : undefined} bold={selected}>
          {confirmingDelete
            ? t("tui.jobs.confirmDelete", { name: job.name }, `Press d again to delete ${job.name}`)
            : job.name}
        </Text>
        <Text dimColor>
          {" "}
          · {formatSchedule(job)} · {t("tui.jobs.lastTriggered", "last trigger")} {last}
        </Text>
      </Box>
      {expanded ? <JobDetail job={job} now={now} /> : null}
    </Box>
  )
}

function JobDetail({ job, now }: { job: Job; now: number }) {
  const kind = payloadKind(job.payload)
  const next: RelativeTime | null = relativeTime(job.nextRunAt, now)
  const estimate = scheduleEstimate(job)
  // Trigger history: the 5 most recent trail entries, newest first.
  const events = jobDetailEvents(job, 5)
  return (
    <Box flexDirection="column" paddingLeft={4} marginBottom={1}>
      <Text dimColor>
        {t("tui.jobs.estimate", "next fire")}:{" "}
        {estimate.kind === "interval"
          ? estimate.label
          : estimate.kind === "cron"
            ? `${t("tui.jobs.estimate.cron", "cron — exact time not computed")} (${estimate.label})`
            : estimate.label}
      </Text>
      <Text dimColor>
        {t("tui.jobs.payload", "payload")}: {t(payloadLabelKey(kind), kind)}
        {kind === "workspace" && typeof (job.payload as { message?: unknown })?.message === "string"
          ? ` — ${(job.payload as { message: string }).message.slice(0, 60)}`
          : ""}
      </Text>
      <Text dimColor>
        {t("tui.jobs.nextRun", "next run")}: {formatRelativeTime(next, "—")} ·{" "}
        {t("tui.jobs.triggerCount", "fires")}: {job.triggerCount}
      </Text>
      <Text dimColor>{t("tui.jobs.recentEvents", "recent events")}:</Text>
      {events.length === 0 ? (
        <Text dimColor> —</Text>
      ) : (
        events.map((event, i) => {
          const label = jobEventKindLabel(event?.kind)
          const kindText = label.known
            ? t(label.key, typeof event?.kind === "string" ? event.kind : "unknown")
            : typeof event?.kind === "string" && event.kind.length > 0
              ? event.kind
              : t("tui.jobs.event.unknown", "unknown")
          return (
            <Text key={`${event?.at ?? "?"}-${i}`} dimColor>
              {" "}
              {formatJobEvent(event, now, kindText)}
            </Text>
          )
        })
      )}
    </Box>
  )
}

export default JobsDialog
