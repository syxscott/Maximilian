import { Suspense, lazy, useState, useEffect, useRef, useCallback, useMemo } from "react"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Toaster } from "@/components/ui/sonner"
import { useHealth, useWorkspaces } from "@/lib/api/hooks"
import { useLocale, t } from "@max/i18n"
import { chatApi, openWorkspaceStream } from "./api"
import type { Workspace, RuntimeEvent, WorkspaceStreamHandle, Health } from "./api"
import { ChatPanel } from "./components/ChatPanel"
import { SubagentsPanel } from "./components/SubagentsPanel"
import { TrajectoryPanel } from "./features/trajectory"
import { FileChangesPanel } from "./components/FileChangesPanel"
import { SessionsPanel } from "./components/SessionsPanel"
import {
  LeaderboardTable,
  TruthReportPanel,
  OracleTriadConsole,
} from "./components/observability/panels"
import { WorkflowRunsPanel } from "./components/WorkflowRunsPanel"
import { ArtifactsExplorer } from "./components/ArtifactsExplorer"
import { WorkspaceTabStrip } from "./components/WorkspaceTabStrip"
import { AgentPanel } from "./components/AgentPanel"
import { TaskPanel } from "./components/TaskPanel"
import { OutputPanel } from "./components/OutputPanel"
import { ReviewPanel } from "./components/ReviewPanel"
import { ThemeToggle } from "./components/ThemeToggle"
import { LocaleSwitcher } from "./components/LocaleSwitcher"
import { LiveUsagePill } from "./components/LiveUsagePill"
import { PermissionDialog } from "./components/PermissionDialog"
import { AppCommandPalette } from "./components/AppCommandPalette"
import { ToastHost } from "./components/ToastHost"
import { commandsWithKeybinds, type Keybind } from "./lib/commands"
import { permissionsApi, type PendingPermission } from "./lib/permissions"
import { usePerfTier } from "./lib/perf-tier"
import { useTheme } from "./lib/theme"
import {
  useConnectionStore,
  useConnectionStatus,
  useConnectionError,
  healthLabelKey,
} from "./stores/connectionStore"
import { useSessionProjectionStore } from "./stores/sessionProjectionStore"
import { useWorkspacePrefs, useWorkspacePrefsStore } from "./stores/workspacePrefsStore"
import { useNotificationStore } from "./stores/notificationStore"

/** Prefs key for shell-level state before any workspace is active. */
const SHELL_PREFS_KEY = "__app__"

// ── Connection store plumbing (single writer: the App layer) ────────────────

/**
 * Inject the transport health into connectionStore — the store's only
 * writer. Query observations flow through setHealth (ok → reachable,
 * anything else → degraded); query failures flow through setError so the
 * error stays sticky until a healthy observation replaces it.
 */
export function useConnectionSync(
  health: { status: string } | undefined,
  healthError: unknown,
): void {
  useEffect(() => {
    if (healthError) {
      useConnectionStore
        .getState()
        .setError(healthError instanceof Error ? healthError.message : String(healthError))
      return
    }
    if (health) {
      useConnectionStore.getState().setHealth(health.status === "ok" ? "reachable" : "degraded")
    }
  }, [health, healthError])
}

/**
 * The header health pill — rendered purely from connectionStore state
 * (plus the telemetry details the store intentionally doesn't hold).
 */
export function ConnectionBanner({ health }: { health: Health | undefined }) {
  const status = useConnectionStatus()
  const error = useConnectionError()
  const lastCheckedAt = useConnectionStore((s) => s.lastCheckedAt)
  // Nothing observed yet and no failure recorded — render nothing (the
  // pre-first-poll state matches the old header's "no pill" behavior).
  if (lastCheckedAt === null && error === null) return null
  if (status !== "reachable") {
    return (
      <div
        className="flex items-center gap-2 text-sm text-destructive"
        data-testid="connection-banner"
      >
        <span className="inline-block w-2 h-2 rounded-full bg-destructive" />
        <span>{t(healthLabelKey(status))}</span>
        {error && (
          <span className="max-w-64 truncate text-xs text-muted-foreground">
            {t("stores.connection.lastError", { message: error.message })}
          </span>
        )}
      </div>
    )
  }
  return (
    <div
      className="flex items-center gap-3 text-sm text-muted-foreground"
      data-testid="connection-banner"
    >
      <span className="inline-block w-2 h-2 rounded-full bg-green-500" />
      <span>{t(healthLabelKey(status))}</span>
      {health && (
        <>
          <span>{t("app.footer.telemetry", { telemetry: health.telemetry })}</span>
          <span>{t("app.footer.meta", { meta: health.metaAgent })}</span>
          <span>{t("app.footer.providersCount", { count: health.providers.length })}</span>
        </>
      )}
    </div>
  )
}

// Lazy-load the heavier panels so the initial bundle stays light. On high
// perf tier, eager loading is fine but lazy still saves parse time on first
// paint — keeping it lazy universally simplifies the wiring.
const ExecutionCanvas = lazy(() =>
  import("./components/ExecutionCanvas").then((m) => ({ default: m.ExecutionCanvas })),
)
const GovernancePortal = lazy(() =>
  import("./components/GovernancePortal").then((m) => ({ default: m.GovernancePortal })),
)
const EvolutionTree = lazy(() =>
  import("./components/EvolutionTree").then((m) => ({ default: m.EvolutionTree })),
)
const ProviderPanel = lazy(() =>
  import("./components/ProviderPanel").then((m) => ({ default: m.ProviderPanel })),
)
const UsagePanel = lazy(() =>
  import("./components/UsagePanel").then((m) => ({ default: m.UsagePanel })),
)
const SettingsPanel = lazy(() =>
  import("./components/SettingsPanel").then((m) => ({ default: m.SettingsPanel })),
)

type Tab =
  "workspace" | "executions" | "governance" | "evolution" | "providers" | "usage" | "settings"

function TabFallback({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
      {t("common.loading")}
    </div>
  )
}

export function App() {
  const [tab, setTab] = useState<Tab>("workspace")
  const [commandOpen, setCommandOpen] = useState(false)
  const { data: health, error: healthError } = useHealth()
  // Subscribe to locale changes so tabs (and any other t() calls below)
  // re-render when the user switches language in Settings.
  useLocale()
  // Surface perf tier in devtools — also ensures the tier class lands on
  // <html> before any tab paints its heavy components.
  usePerfTier()

  // ── Connection store injection (single writer: the App layer) ────────────
  // useHealth observations flow into connectionStore via setHealth; query
  // failures flow through setError. The header banner renders the store
  // state, so the status pill, the sticky error and any future consumer
  // all read one source of truth.
  useConnectionSync(health, healthError)

  // ── Session projection store injection ───────────────────────────────────
  // The workspace event stream lives in the `events` useState below; a
  // parallel effect mirrors every change into sessionProjectionStore, which
  // derives the turns / last-activity / running-tasks projection. The
  // trajectory and subagents panels read the store (selectors) instead of
  // threading the array through props again.
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [events, setEvents] = useState<RuntimeEvent[]>([])
  useEffect(() => {
    useSessionProjectionStore.getState().setEvents(events)
  }, [events])
  const [submitting, setSubmitting] = useState(false)
  // Sidebar visibility is a workspace preference now: it persists per
  // workspace (or app-wide before one is open) via workspacePrefsStore.
  const sidebarPrefsKey = workspace?.id ?? SHELL_PREFS_KEY
  const sidebarHidden = useWorkspacePrefs(sidebarPrefsKey).sidebarHidden
  // Holds the active stream handle returned by `openWorkspaceStream`.
  // The implementation switched from native EventSource to fetch +
  // ReadableStream so the Authorization bearer token can ride along;
  // the handle exposes `.close()` to mirror the EventSource lifecycle.
  const streamRef = useRef<WorkspaceStreamHandle | null>(null)
  // Used to cancel an in-flight POST when the user re-submits. SSE itself
  // can't be aborted (browser API doesn't allow it), but the chat request
  // can, and we close the previous stream in stopStream().
  const abortRef = useRef<AbortController | null>(null)
  // Queue of un-answered permission/approval prompts, keyed by
  // `requestId`. The runtime emits a fresh resolver for every prompt and
  // multiple DAG tasks can prompt in parallel — the previous single-slot
  // state would overwrite the earlier pending and orphan its resolver
  // forever (the user could only answer whichever prompt was displayed
  // last). The dialog renders one at a time (FIFO) with a "skip" action
  // when more are queued. `currentPending` is derived for the dialog
  // and `parkedTaskIds` collects every taskId for the sidebar.
  const [pendingPermissions, setPendingPermissions] = useState<Map<string, PendingPermission>>(
    () => new Map(),
  )
  const currentPending: PendingPermission | null =
    pendingPermissions.size > 0 ? (pendingPermissions.values().next().value ?? null) : null
  // Consecutive error count for the current stream. We reconnect up to
  // SSE_MAX_RETRIES transient failures before giving up; beyond that we
  // close the stream so the UI doesn't spin forever on a permanent
  // failure (404, 403, repeated 5xx).
  const sseErrorCount = useRef(0)
  const SSE_MAX_RETRIES = 5
  // Request token — monotonically increasing per submit. Every async
  // callback (SSE message, onerror, finally) checks `tokenRef.current ===
  // myToken` before touching state. Without this:
  //   - a stale `es.onerror` from a previous submission can race the new
  //     one and reset the new submission's sseErrorCount
  //   - the `finally` guard `!abortRef.current.signal.aborted` was always
  //     false because we replace `abortRef.current` immediately after
  //     aborting (line 84), so `submitting` could stay stuck on true after
  //     a successful response if the SSE stream happened to error after.
  //   - the `done` event handler didn't reset submitting at all, leaving
  //     the Send button disabled until the next interaction.
  const tokenRef = useRef(0)

  // @mention suggestions (ZCode prompt-editor borrowing): the agent roles
  // in play for this workspace, falling back to the built-in quartet.
  const mentionSuggestions = useMemo(() => {
    const roles = new Set<string>()
    for (const task of workspace?.plan?.tasks ?? []) {
      if (task.agentRole) roles.add(task.agentRole)
    }
    if (roles.size === 0) for (const r of ["general", "backend", "frontend", "review"]) roles.add(r)
    return [...roles].map((token) => ({ token, description: t("mention.agentRole") }))
  }, [workspace?.plan?.tasks])

  // Ref bridge so the global keyboard layer (mounted once) can invoke the
  // latest abortSubmission without re-binding its listener.
  const abortSubmissionRef = useRef<() => void>(() => {})
  // Same bridge pattern for the sidebar toggle: the keyboard layer reads
  // the latest closure without re-binding, and the toggle writes the
  // workspace-prefs store for the currently active prefs key.
  const toggleSidebarRef = useRef<() => void>(() => {})
  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.close()
      streamRef.current = null
    }
  }, [])

  // Toggle the sidebar through the prefs store (persisted per workspace).
  toggleSidebarRef.current = () => {
    const key = sidebarPrefsKey
    const current = useWorkspacePrefsStore.getState().prefs[key]?.sidebarHidden ?? false
    useWorkspacePrefsStore.getState().updatePrefs(key, { sidebarHidden: !current })
  }

  // Abort the in-flight submission + close the SSE stream. Bound to the
  // Stop button in ChatPanel. STOPS UI ONLY: this aborts the browser
  // fetch and closes the local stream, but the backend workspace keeps
  // executing until a `/api/workspaces/:id/cancel` endpoint exists and
  // is wired through. The orphan workspace continues running and its
  // events fire into the void (no subscriber); the user's UI clears
  // and they can start fresh. Adding the cancel endpoint is tracked as
  // a follow-up — it would call `runtime.interrupt(workspaceId, ...)`
  // to surface a `RuntimeInterrupt` to the executing task loop.
  const abortSubmission = useCallback(() => {
    abortRef.current?.abort()
    stopStream()
    // Bump the token so any pending stream `onMessage` / `onError`
    // callbacks from the old stream short-circuit without flipping
    // `submitting` after we've already cleared it below.
    tokenRef.current++
    setSubmitting(false)
  }, [stopStream])
  abortSubmissionRef.current = abortSubmission

  useEffect(() => () => stopStream(), [stopStream])

  // Recent-workspaces list. Used by the switcher in the footer; surfaces
  // workspaces from `GET /api/workspaces` so the user can revisit a past
  // run without re-submitting. Backed by `EventLogRegistry`-durable state
  // on the backend, so it survives API restarts.
  const { data: workspaceList } = useWorkspaces({ limit: 20 })

  /**
   * Switch to a previous workspace. Cancels any active submission and
   * closes the current SSE stream before pulling the snapshot — without
   * this, a stale stream from the previous workspace would race the
   * GET and overwrite the new `workspace` state mid-fetch. We don't
   * restart the SSE stream for past workspaces: the snapshot is the
   * final state, so live replay would only generate noise.
   */
  const pickWorkspace = useCallback(
    async (id: string) => {
      abortRef.current?.abort()
      stopStream()
      const myToken = ++tokenRef.current
      setSubmitting(false)
      try {
        const ws = await chatApi.getWorkspace(id)
        // If the user navigated away / switched tabs during the fetch,
        // don't clobber whatever is now active.
        if (tokenRef.current !== myToken) return
        setWorkspace(ws)
        setEvents([])
      } catch (err) {
        console.error("pickWorkspace failed", err)
        // Real notification (notificationStore → ToastHost): the switch the
        // user asked for did not happen, so say so instead of failing
        // silently in the console.
        useNotificationStore.getState().push("error", "shell.notify.workspaceSwitchFailed", {
          workspaceId: id,
        })
      }
    },
    [stopStream],
  )

  async function handleSubmit(message: string) {
    // Cancel any in-flight request and close any open stream first. Without
    // this, rapid clicks on the Send button would open N parallel SSE
    // connections and leak streams when the user navigates away mid-stream.
    abortRef.current?.abort()
    abortRef.current = new AbortController()
    stopStream()

    const myToken = ++tokenRef.current
    setSubmitting(true)
    try {
      const { workspaceId } = await chatApi.chat(message, abortRef.current.signal)
      // If a newer submit landed while we were POSTing, drop this stream.
      if (tokenRef.current !== myToken) return
      setEvents([])

      // Build the message handlers first so the retry path inside
      // `onError` can re-open with the same callbacks. Each handler
      // closes over `myToken` to filter out stale frames after a newer
      // submit has replaced this one.
      const handleMessage = (data: Record<string, unknown>) => {
        // Ignore messages from a stale stream (a newer submit replaced us).
        if (tokenRef.current !== myToken) return
        // A successful message resets the retry counter — the connection
        // is healthy and we should tolerate the next transient failure.
        sseErrorCount.current = 0
        try {
          if (data.type === "workspace") {
            setWorkspace(data.workspace as Workspace)
          } else if (data.type === "event") {
            const ev = data.event as { type?: string } & Record<string, unknown>
            setEvents((prev) => [...prev, ev as RuntimeEvent])
            // Pull fields via narrow validators so a malformed envelope can't
            // shove `undefined` into a field that downstream code treats as a
            // string. Previously a `permission-request` with `requestId: null`
            // would open the dialog with `requestId === undefined`, and the
            // matching `permission-resolved` (also missing requestId) would
            // compare `undefined === undefined` and dismiss the *current*
            // prompt instead of the older one.
            const strField = (key: string) =>
              typeof ev[key] === "string" ? (ev[key] as string) : undefined
            const boolField = (key: string) =>
              typeof ev[key] === "boolean" ? (ev[key] as boolean) : undefined
            if (ev.type === "permission-request") {
              const requestId = strField("requestId")
              if (!requestId) return
              setPendingPermissions((prev) => {
                const next = new Map(prev)
                next.set(requestId, {
                  kind: "permission",
                  requestId,
                  workspaceId: strField("workspaceId") ?? "",
                  taskId: strField("taskId") ?? "",
                  tool: strField("tool") ?? "",
                  target: strField("target") ?? "",
                  input: ev.input ?? undefined,
                })
                return next
              })
            } else if (ev.type === "permission-resolved") {
              const requestId = strField("requestId")
              if (!requestId) return
              setPendingPermissions((prev) => {
                if (!prev.has(requestId)) return prev
                const next = new Map(prev)
                next.delete(requestId)
                return next
              })
            } else if (ev.type === "approval-request") {
              const requestId = strField("requestId")
              if (!requestId) return
              setPendingPermissions((prev) => {
                const next = new Map(prev)
                next.set(requestId, {
                  kind: "approval",
                  requestId,
                  workspaceId: strField("workspaceId") ?? "",
                  taskId: strField("taskId") ?? "",
                  prompt: strField("prompt") ?? "",
                  reason: strField("reason"),
                  requireComment: boolField("requireComment"),
                })
                return next
              })
            } else if (ev.type === "approval-resolved") {
              const requestId = strField("requestId")
              if (!requestId) return
              setPendingPermissions((prev) => {
                if (!prev.has(requestId)) return prev
                const next = new Map(prev)
                next.delete(requestId)
                return next
              })
            }
          } else if (data.type === "done") {
            // Tear the stream down. The fetch+ReadableStream impl does
            // not auto-reconnect like EventSource did, so the retry
            // counter is driven from `onError` and we reopen manually
            // from there on transient failures.
            streamRef.current?.close()
            if (streamRef.current && tokenRef.current === myToken) {
              // submit succeeded; the `done` event closes the lifecycle.
            }
            if (tokenRef.current === myToken) setSubmitting(false)
          }
        } catch (err) {
          console.error("SSE parse error", err)
        }
      }

      const handleError = (err: unknown) => {
        // Ignore errors from a stale stream.
        if (tokenRef.current !== myToken) return
        // The fetch+ReadableStream impl does NOT auto-reconnect like
        // EventSource did. We manually re-open up to SSE_MAX_RETRIES
        // transient failures before giving up; beyond that we close
        // the stream so the UI doesn't spin forever on a permanent
        // failure (404, 403, repeated 5xx).
        sseErrorCount.current += 1
        if (sseErrorCount.current >= SSE_MAX_RETRIES) {
          console.warn(`SSE gave up after ${sseErrorCount.current} consecutive errors`, err)
          streamRef.current?.close()
          if (tokenRef.current === myToken) setSubmitting(false)
        } else {
          console.warn(
            `SSE connection error (reconnecting, attempt ${sseErrorCount.current}/${SSE_MAX_RETRIES})`,
            err,
          )
          // During reconnect, KEEP submitting=true so the user knows
          // the workspace is still in-flight. The previous EventSource
          // implementation reset submitting on every transient blip,
          // making the button flicker between disabled and enabled
          // while we were still trying to recover.
          const current = streamRef.current
          if (current) {
            current.close()
            streamRef.current = openWorkspaceStream(workspaceId, {
              onMessage: handleMessage,
              onError: handleError,
              onClose: () => {
                if (streamRef.current && tokenRef.current === myToken) {
                  // Only null out if this is still our stream — a newer
                  // submit may have already replaced it.
                  // (No-op: the retry path's reassignment below is the
                  // only writer.)
                }
              },
            })
          }
        }
      }

      streamRef.current = openWorkspaceStream(workspaceId, {
        onMessage: handleMessage,
        onError: handleError,
        onClose: () => {
          // The handle self-nulls only when we're still the current
          // submit. A newer submit has its own stream and its own
          // ref value, so this branch leaves a replacement alone.
          if (tokenRef.current === myToken) {
            // Stream closed cleanly (e.g. terminal `done`); the `done`
            // handler above already flipped submitting back. No-op here.
          }
        },
      })
      sseErrorCount.current = 0
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return
      console.error("chat error", err)
      stopStream()
      // Only flip submitting off if this submit is still the active one
      // (a newer submission may have already taken over).
      if (tokenRef.current === myToken) setSubmitting(false)
    }
    // No `finally` — the success path resolves via `done` event, the
    // catch path handles its own setSubmitting(false), and the error-gave-up
    // branch handles its own. The previous finally block's
    // `!abortRef.current.signal.aborted` guard was always false because
    // we replace abortRef.current on line 84 immediately after aborting.
  }

  const answerPermission = useCallback(
    async (decision: "allow" | "deny") => {
      const target = pendingPermissions.values().next().value as PendingPermission | undefined
      if (!target || target.kind !== "permission") return
      const id = target.requestId
      try {
        await permissionsApi.answer(id, decision)
        // Close the dialog only after the server has acknowledged the
        // answer. The previous implementation always cleared in
        // `finally`, which meant a network/server error would silently
        // dismiss the prompt — the user thinks they answered, but the
        // backend never received the decision and the next tool call
        // will re-prompt (now with no UX indication that the previous
        // attempt failed).
        setPendingPermissions((prev) => {
          if (!prev.has(id)) return prev
          const next = new Map(prev)
          next.delete(id)
          return next
        })
      } catch (err) {
        console.error("[perms] answer failed", err)
        // Real notification: the decision was NOT delivered — leave the
        // dialog open and tell the user, or they'd believe the tool is
        // unblocked while the backend is still waiting.
        useNotificationStore.getState().push("error", "shell.notify.permissionFailed")
        // Leave the dialog open so the user can retry. A subsequent
        // permission-resolved event (if the request actually did
        // reach the server) is idempotent and still closes the
        // dialog via the SSE handler.
      }
    },
    [pendingPermissions],
  )

  const answerApproval = useCallback(
    async (decision: "approve" | "reject", comment?: string) => {
      const target = pendingPermissions.values().next().value as PendingPermission | undefined
      if (!target || target.kind !== "approval") return
      const id = target.requestId
      // A rejection is a steering decision the agent will see — surface it
      // as a notification so the user gets feedback beyond the dialog
      // closing.
      if (decision === "reject") {
        useNotificationStore
          .getState()
          .push("warning", "shell.notify.steeringRejected", { task: target.taskId || id })
      }
      try {
        await permissionsApi.answerApproval(id, decision, comment)
        // Same reasoning as answerPermission above: only close on
        // server acknowledgement so a failed POST doesn't leave the
        // user thinking their decision was recorded.
        setPendingPermissions((prev) => {
          if (!prev.has(id)) return prev
          const next = new Map(prev)
          next.delete(id)
          return next
        })
      } catch (err) {
        console.error("[approvals] answer failed", err)
      }
    },
    [pendingPermissions],
  )

  // Skip the currently-displayed prompt without sending a decision to
  // the server. Used when multiple prompts are queued and the user
  // wants to defer the current one to the back of the queue.
  // The prompt stays pending (its resolver still lives on the runtime
  // side); we just rotate the dialog to the next entry. The user can
  // come back via "Previous" or simply by re-opening the queue, but
  // for now we keep it minimal — the FIFO rotation is the only path.
  const skipCurrentPermission = useCallback(() => {
    setPendingPermissions((prev) => {
      if (prev.size <= 1) return prev
      const first = prev.keys().next().value
      if (!first) return prev
      const entry = prev.get(first)
      if (!entry) return prev
      const next = new Map(prev)
      next.delete(first)
      // Reinsert at the back so the dialog advances to the next entry.
      next.set(first, entry)
      return next
    })
  }, [])

  // Cmd/Ctrl+K opens the command palette. Bound at the App level so it works
  // regardless of which tab is active. Skipped when typing in an input,
  // textarea, or contenteditable so the keystroke isn't hijacked while the
  // user is editing.
  useEffect(() => {
    // Full command keyboard layer (ZCode useAppKeyboard borrowing): every
    // keybind in the command registry works globally, skipping keystrokes
    // aimed at editable targets.
    function matches(kb: Keybind, e: KeyboardEvent): boolean {
      const mod = e.metaKey || e.ctrlKey
      if (kb.mod !== undefined && kb.mod !== mod) return false
      if (kb.mod === undefined && mod) return false
      if (Boolean(kb.shift) !== e.shiftKey) {
        // A plain-letter keybind must not fire for Shift+letter combos.
        if (kb.key.length === 1 ? e.shiftKey !== Boolean(kb.shift) : true) return false
      }
      if (Boolean(kb.alt) !== e.altKey) return false
      return e.key.toLowerCase() === kb.key.toLowerCase()
    }
    function onKeyDown(e: KeyboardEvent) {
      // Cmd/Ctrl+K toggles the palette even from editable targets ONLY when
      // no other modifiers ride along — palette muscle memory wins here.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k" && !e.altKey && !e.shiftKey) {
        e.preventDefault()
        setCommandOpen((prev) => !prev)
        return
      }
      const target = e.target as Element | null
      if (target) {
        const tag = target.tagName.toLowerCase()
        if (tag === "input" || tag === "textarea" || (target as HTMLElement).isContentEditable) {
          return
        }
      }
      for (const command of commandsWithKeybinds()) {
        const kb = command.keybind!
        if (!matches(kb, e)) continue
        e.preventDefault()
        if (command.navigateTo) setTab(command.navigateTo)
        if (command.action === "open-palette") setCommandOpen(true)
        if (command.action === "toggle-sidebar") toggleSidebarRef.current()
        if (command.action === "stop-stream") abortSubmissionRef.current()
        return
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  // The palette's "Toggle theme" action delegates to the same setMode the
  // ThemeToggle button uses — keeping a single source of truth (`useTheme`)
  // so the in-memory state, the localStorage write, and the <html> class
  // stay in lock-step. Earlier this function wrote `mx-theme` directly and
  // left the theme hook stale, so a follow-up click on ThemeToggle flipped
  // the screen back to the previously-persisted mode.
  const theme = useTheme()
  const toggleTheme = useCallback(() => {
    const next = theme.mode === "dark" ? "light" : "dark"
    theme.setMode(next)
  }, [theme.mode, theme.setMode])

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <Toaster />
      {/* Durable notification stack (notificationStore consumer). */}
      <ToastHost />
      <PermissionDialog
        pending={currentPending}
        queueSize={pendingPermissions.size}
        onSkip={skipCurrentPermission}
        onAnswer={answerPermission}
        onApprovalAnswer={answerApproval}
      />
      <AppCommandPalette
        open={commandOpen}
        onOpenChange={setCommandOpen}
        onNavigate={setTab}
        onToggleTheme={toggleTheme}
        onOpenUsage={() => setTab("usage")}
      />

      {/* Header */}
      <header className="border-b border-border px-6 py-3 flex items-center justify-between bg-muted/30">
        <h1 className="text-xl font-semibold">
          Maximilian{" "}
          <span className="text-muted-foreground text-base font-medium">{t("app.subtitle")}</span>
        </h1>
        <div className="flex items-center gap-3">
          {/* Health banner — rendered from connectionStore state (injected
              from useHealth above), so every consumer shares one status. */}
          <ConnectionBanner health={health} />
          <LiveUsagePill onOpenUsage={() => setTab("usage")} />
          <LocaleSwitcher />
          <ThemeToggle />
        </div>
      </header>

      {/* Multi-workspace tab strip (ZCode titlebar borrowing) */}
      <WorkspaceTabStrip
        workspaces={workspaceList?.items ?? []}
        activeId={workspace?.id}
        onPick={(id) => {
          if (id !== workspace?.id) pickWorkspace(id)
        }}
      />

      {/* Tab bar */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <nav className="px-6 border-b border-border bg-background">
          <TabsList>
            <TabsTrigger value="workspace">{t("nav.workspace")}</TabsTrigger>
            <TabsTrigger value="executions">{t("nav.executions")}</TabsTrigger>
            <TabsTrigger value="governance">{t("nav.governance")}</TabsTrigger>
            <TabsTrigger value="evolution">{t("nav.evolution")}</TabsTrigger>
            <TabsTrigger value="usage">{t("nav.usage")}</TabsTrigger>
            <TabsTrigger value="providers">{t("nav.providers")}</TabsTrigger>
            <TabsTrigger value="settings">{t("nav.settings")}</TabsTrigger>
          </TabsList>
        </nav>

        <main className="flex-1 overflow-auto p-6">
          <TabsContent value="workspace">
            <div className="h-[calc(100vh-8rem)] rounded-lg border border-border bg-card overflow-hidden">
              <ChatPanel
                onSubmit={handleSubmit}
                onAbort={abortSubmission}
                submitting={submitting}
                workspace={workspace}
                mentionSuggestions={mentionSuggestions}
                onOpenProviders={() => setTab("providers")}
                onOpenPalette={() => setCommandOpen(true)}
                events={events}
                live={submitting}
                sidebarHidden={sidebarHidden}
                sidebar={
                  <div className="flex flex-col gap-4">
                    <AgentPanel
                      workspace={workspace}
                      parkedTaskIds={
                        pendingPermissions.size > 0
                          ? new Set(Array.from(pendingPermissions.values()).map((p) => p.taskId))
                          : undefined
                      }
                    />
                    <TaskPanel workspace={workspace} />
                    {/* Trajectory + subagents read the session projection
                        store (kept in sync with `events` above). */}
                    <SubagentsPanel />
                    <TrajectoryPanel />
                    <FileChangesPanel events={events} />
                    <SessionsPanel workspaceId={workspace?.id} />
                    <ArtifactsExplorer workspaceId={workspace?.id} />
                    {workspace?.review ? (
                      <ReviewPanel workspace={workspace} />
                    ) : (
                      <OutputPanel workspace={workspace} />
                    )}
                  </div>
                }
              />
            </div>
          </TabsContent>
          <TabsContent value="executions">
            <Suspense fallback={<TabFallback label={t("nav.executions")} />}>
              <div className="space-y-4">
                <ExecutionCanvas />
                <WorkflowRunsPanel />
              </div>
            </Suspense>
          </TabsContent>
          <TabsContent value="governance">
            <Suspense fallback={<TabFallback label={t("nav.governance")} />}>
              <GovernancePortal />
            </Suspense>
          </TabsContent>
          <TabsContent value="evolution">
            <Suspense fallback={<TabFallback label={t("nav.evolution")} />}>
              <div className="space-y-4">
                <EvolutionTree />
                <LeaderboardTable />
                <TruthReportPanel />
                <OracleTriadConsole />
              </div>
            </Suspense>
          </TabsContent>
          <TabsContent value="providers">
            <Suspense fallback={<TabFallback label={t("nav.providers")} />}>
              <ProviderPanel />
            </Suspense>
          </TabsContent>
          <TabsContent value="usage">
            <Suspense fallback={<TabFallback label={t("nav.usage")} />}>
              <UsagePanel />
            </Suspense>
          </TabsContent>
          <TabsContent value="settings">
            <Suspense fallback={<TabFallback label={t("nav.settings")} />}>
              <SettingsPanel />
            </Suspense>
          </TabsContent>
        </main>
      </Tabs>

      {/* Workspace footer */}
      {tab === "workspace" && (
        <footer className="px-6 py-1.5 text-xs flex gap-4 items-center border-t border-border bg-muted/30 text-muted-foreground">
          <span>
            {t("app.footer.status", { status: workspace?.status ?? t("statusAgent.idle") })}
          </span>
          <div className="flex items-center gap-2">
            <span>{t("footer.workspace")}:</span>
            {/* Recent-workspaces switcher. Closes the gap from the
                phase5 audit: GET /api/workspaces was an orphan route —
                now the user can re-open any past run from this dropdown.
                Picking a workspace cancels any active submission and
                closes the live SSE stream (live replay would only be
                noise on a finalized workspace). */}
            <Select
              value={workspace?.id ?? ""}
              onValueChange={(id) => {
                if (id && id !== workspace?.id) pickWorkspace(id)
              }}
            >
              <SelectTrigger
                className="h-6 w-auto min-w-[12rem] max-w-[20rem] text-xs px-2 py-0 border-border bg-background"
                aria-label={t("footer.workspaceSwitcher")}
              >
                <SelectValue placeholder={t("footer.workspacePlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {(workspaceList?.items ?? []).map((id) => (
                  <SelectItem key={id} value={id}>
                    {id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <span>{t("app.footer.tasks", { count: workspace?.plan?.tasks.length ?? 0 })}</span>
        </footer>
      )}
    </div>
  )
}
