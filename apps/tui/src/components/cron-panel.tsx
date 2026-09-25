import React, { useEffect, useRef, useState } from "react"
import { t } from "@max/i18n"
import { Box, Text, useInput } from "ink"
import TextInput from "ink-text-input"

import type { Job } from "../api"
import { useSDK } from "../context/sdk"
import { useToast } from "./toast"
import { useJobs, createJobViaSdk, deleteJobViaSdk } from "../hooks/useJobs"
import { cronJobCreateInput, cronValidationError, filterCronJobs } from "./cron-model"
import { elapsedSeconds, formatRelativeTime, relativeTime } from "./jobs-model"
import "../locales/tui-panels"

/**
 * Cron panel — the cron-scheduled slice of GET /api/jobs (the digit-interval
 * jobs stay in the Jobs dialog): one row per cron job (name · schedule ·
 * last-trigger relative time), c opens an inline three-step create form
 * (name → 5-field cron expression → workspace message) that POSTs the real
 * kind:"workspace" dispatch through /api/jobs (round-7 BullMQ producer
 * path), d deletes with a two-press confirm, r refreshes. The create form
 * steps BACK on backspace-over-empty (esc is owned by the DialogProvider —
 * pressing it would close the whole panel, not just the form).
 */
export function CronPanel() {
  const sdk = useSDK()
  const toast = useToast()
  const { jobs, isError, isLoading, error, refresh } = useJobs()
  const cronJobs = filterCronJobs(jobs)
  const [cursor, setCursor] = useState(0)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState<"list" | "create">("list")
  // 1s heartbeat so the refresh hint ages without waiting for a keypress.
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [])
  const nowRef = useRef(Date.now())
  const loadedOnceRef = useRef(false)
  if (!isLoading) loadedOnceRef.current = true

  const maxCursor = Math.max(0, cronJobs.length - 1)
  const safeCursor = Math.min(cursor, maxCursor)
  const selected = cronJobs.length > 0 ? cronJobs[safeCursor] : undefined

  async function performCreate(name: string, schedule: string, message: string) {
    if (busy) return
    setBusy(true)
    try {
      const created = await createJobViaSdk(sdk.client, cronJobCreateInput(name, schedule, message))
      toast.show({
        variant: "success",
        message: t("tui.cron.created", { name: created.name ?? name }, `Cron job ${name} created`),
        duration: 2000,
      })
      setMode("list")
      nowRef.current = Date.now()
      refresh()
    } catch (err) {
      toast.show({
        variant: "error",
        message: t(
          "tui.cron.createFailed",
          { error: err instanceof Error ? err.message : String(err) },
          `Create failed: ${err instanceof Error ? err.message : String(err)}`,
        ),
        duration: 4000,
      })
    } finally {
      setBusy(false)
    }
  }

  async function performDelete(job: Job) {
    if (busy) return
    setBusy(true)
    try {
      await deleteJobViaSdk(sdk.client, job.id)
      toast.show({
        variant: "success",
        message: t("tui.cron.deleted", { name: job.name }, `Job ${job.name} deleted`),
        duration: 2000,
      })
      setConfirmDeleteId(null)
      nowRef.current = Date.now()
      refresh()
    } catch (err) {
      toast.show({
        variant: "error",
        message: t(
          "tui.cron.deleteFailed",
          { error: err instanceof Error ? err.message : String(err) },
          `Delete failed: ${err instanceof Error ? err.message : String(err)}`,
        ),
        duration: 4000,
      })
    } finally {
      setBusy(false)
    }
  }

  useInput((input, key) => {
    // In create mode every keystroke belongs to the TextInput — no list
    // navigation, no delete, no refresh leaks into the form.
    if (mode === "create") return
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
    if (input === "r") {
      nowRef.current = Date.now()
      refresh()
      return
    }
    if (input === "c") {
      setConfirmDeleteId(null)
      setMode("create")
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
    // Any other key disarms the delete confirm (matches the jobs dialog).
    if (confirmDeleteId !== null) setConfirmDeleteId(null)
  })

  const now = nowRef.current

  return (
    <Box flexDirection="column" paddingLeft={1} paddingRight={1}>
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold>
          {t("tui.cron", "Cron")}
          {cronJobs.length > 0 ? ` (${cronJobs.length})` : ""}
        </Text>
        <Text dimColor>esc</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        {mode === "create" ? (
          <CronCreateForm busy={busy} onSubmit={performCreate} onCancel={() => setMode("list")} />
        ) : isLoading && !loadedOnceRef.current ? (
          <Text color="gray">{t("tui.cron.loading", "Loading cron jobs…")}</Text>
        ) : isError ? (
          <Text color="red">
            {t("tui.cron.error", { error: error ?? "" }, `Failed to load jobs: ${error ?? ""}`)}
          </Text>
        ) : cronJobs.length === 0 ? (
          <Text color="gray">
            {t("tui.cron.empty", "No cron-scheduled jobs — press c to create one.")}
          </Text>
        ) : (
          cronJobs.map((job, index) => (
            <CronJobRow
              key={job.id}
              job={job}
              selected={index === safeCursor}
              confirmingDelete={confirmDeleteId === job.id}
              now={now}
            />
          ))
        )}
      </Box>
      <Box marginTop={1} flexDirection="column">
        {mode === "create" ? null : (
          <>
            <Text dimColor>
              {t("tui.cron.hints", "j/k move · c create · d delete · r refresh · esc close")}
            </Text>
            {(() => {
              const age = elapsedSeconds(now, Date.now())
              return age !== null ? (
                <Text dimColor>
                  {t("tui.jobs.refreshAgo", { seconds: age }, `updated ${age}s ago · r refresh`)}
                </Text>
              ) : null
            })()}
          </>
        )}
      </Box>
    </Box>
  )
}

function CronJobRow(props: {
  job: Job
  selected: boolean
  confirmingDelete: boolean
  now: number
}) {
  const { job, selected, confirmingDelete, now } = props
  const last = formatRelativeTime(
    relativeTime(job.lastTriggeredAt, now),
    t("tui.cron.never", "never"),
  )
  return (
    <Box flexDirection="row">
      <Text> </Text>
      <Text color={selected ? "green" : undefined}>{selected ? "❯" : " "}</Text>
      <Text color="green">● </Text>
      <Text color={selected ? "green" : undefined} bold={selected}>
        {confirmingDelete
          ? t("tui.cron.confirmDelete", { name: job.name }, `Press d again to delete ${job.name}`)
          : job.name}
      </Text>
      <Text dimColor>
        {" "}
        · {typeof job.schedule === "string" ? job.schedule : "?"} ·{" "}
        {t("tui.cron.lastTriggered", "last trigger")} {last}
      </Text>
    </Box>
  )
}

type CreateStep = "name" | "schedule" | "message"

/**
 * The inline create form. Backspace on an empty field steps back (the name
 * step cancels back to the list); esc is deliberately NOT handled — the
 * DialogProvider owns it and would close the whole panel.
 */
function CronCreateForm(props: {
  busy: boolean
  onSubmit: (name: string, schedule: string, message: string) => void
  onCancel: () => void
}) {
  const [step, setStep] = useState<CreateStep>("name")
  const [name, setName] = useState("")
  const [schedule, setSchedule] = useState("")
  const [message, setMessage] = useState("")
  const [scheduleError, setScheduleError] = useState<string | null>(null)

  const value = step === "name" ? name : step === "schedule" ? schedule : message
  const setValue = (next: string) => {
    if (step === "name") setName(next)
    else if (step === "schedule") {
      setSchedule(next)
      if (scheduleError != null) setScheduleError(null)
    } else setMessage(next)
  }

  function submitCurrent() {
    if (props.busy) return
    const trimmed = value.trim()
    if (step === "name") {
      if (trimmed.length > 0) setStep("schedule")
      return
    }
    if (step === "schedule") {
      const invalid = cronValidationError(trimmed.length > 0 ? trimmed : undefined)
      if (invalid != null) {
        setScheduleError(t(invalid.fieldKey, invalid.fieldKey))
        return
      }
      setSchedule(trimmed)
      setStep("message")
      return
    }
    if (trimmed.length > 0) props.onSubmit(name.trim(), schedule.trim(), trimmed)
  }

  useInput((_input, key) => {
    if (!key.delete || props.busy) return
    if (value.length > 0) return // TextInput owns backspace while there is text
    if (step === "message") {
      setStep("schedule")
      return
    }
    if (step === "schedule") {
      setScheduleError(null)
      setStep("name")
      return
    }
    // Backspace on the empty name field cancels the form.
    props.onCancel()
  })

  return (
    <Box flexDirection="column">
      <Text bold>{t("tui.cron.create.title", "New cron job")}</Text>
      <Box marginTop={1} flexDirection="column">
        <Text>
          {step === "name" ? "❯ " : "  "}
          {t("tui.cron.create.name", "Name:")}
        </Text>
        {step === "name" ? (
          <TextInput value={name} onChange={setValue} onSubmit={submitCurrent} />
        ) : null}
        <Text>
          {step === "schedule" ? "❯ " : "  "}
          {t("tui.cron.create.schedule", "Cron expression (5 fields):")}
        </Text>
        {step === "schedule" ? (
          <TextInput value={schedule} onChange={setValue} onSubmit={submitCurrent} />
        ) : null}
        {scheduleError != null ? <Text color="red"> ⚠ {scheduleError}</Text> : null}
        <Text>
          {step === "message" ? "❯ " : "  "}
          {t("tui.cron.create.message", "Message:")}
        </Text>
        {step === "message" ? (
          <TextInput value={message} onChange={setValue} onSubmit={submitCurrent} />
        ) : null}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>
          {t(
            "tui.cron.create.hint",
            "e.g. 0 9 * * * = daily 9am · Enter next · Backspace on empty goes back",
          )}
        </Text>
      </Box>
    </Box>
  )
}

export default CronPanel
