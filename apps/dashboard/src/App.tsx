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
import { useStreamFlusher } from "@max/ui-react"
import { chatApi, openWorkspaceStream } from "./api"
import type { Workspace, RuntimeEvent, WorkspaceStreamHandle, Health } from "./api"
import {
  LeaderboardTable,
  TruthReportPanel,
  OracleTriadConsole,
} from "./components/observability/panels"
import { WorkflowRunsPanel } from "./components/WorkflowRunsPanel"
import { WorkspaceTabStrip } from "./components/WorkspaceTabStrip"
import { WorkspaceDockArea } from "./components/layout/WorkspaceDockArea"
import { ThemeToggle } from "./components/ThemeToggle"
import { LocaleSwitcher } from "./components/LocaleSwitcher"
import { LiveUsagePill } from "./components/LiveUsagePill"
import { PermissionDialog } from "./components/PermissionDialog"
import { AppCommandPalette } from "./components/AppCommandPalette"
import { ToastHost } from "./components/ToastHost"
import { commandsWithKeybinds, type Keybind } from "./lib/commands"
import { permissionsApi, type PendingPermission } from "./lib/permissions"
import {
  browserEnvironment,
  createSseKeepalive,
  type SseKeepaliveHandle,
} from "./lib/sse-keepalive"
import { pendingUplinks } from "./lib/pending-uplinks"
import { registerPendingResend, useOptimisticMessages } from "./lib/optimistic-messages"
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
import { notifySteeringApplied } from "./stores/runtimeNotifications"

/** Prefs key for shell-level state before any workspace is active. */
const SHELL_PREFS_KEY = "__app__"

/**
 * Stream event types that must apply synchronously (deepseek chat-demo
 * borrowing): they drive interactive UI — the permission/approval dialogs
 * and steering notifications — so they never wait for the next animation
 * frame. Every other event type is append-only stream data and joins the
 * rAF commit batch.
 */
const STREAM_CONTROL_EVENT_TYPES: ReadonlySet<string> = new Set([
  "permission-request",
  "permission-resolved",
  "approval-request",
  "approval-resolved",
  "steering-applied",
])

/**
 * Server-truth lookup the durable uplink ledger consults on reconnect
 * (`pendingUplinks.reconcile`). Honest boundary: the API surface has no
 * query endpoint for any uplink kind today — `POST /api/chat` answers with
 * a server-generated workspaceId (there is no client-visible message id to
 * ask about), and the permissions/approvals routes expose only answer
 * endpoints (apps/api/src/routes/permissions.ts, approvals.ts) — so every
 * kind resolves "unknown" and the ledger keeps its clue until an explicit
 * settle or the 24 h TTL. When a query endpoint lands, map each kind to it
 * here; the ledger's accepted/duplicate/failed closure paths are exercised
 * with injected lookups in test/pending-uplinks.test.ts.
 */
function reconcileUplinkLookup(
  id: string,
  kind: string,
): Promise<"accepted" | "duplicate" | "failed" | "unknown"> {
  switch (kind) {
    case "chat":
      // No per-message query endpoint: nothing on the server is keyed by
      // the client-side clue id, and matching workspaces by message text
      // would risk falsely closing a duplicate-submission clue.
      return Promise.resolve("unknown")
    case "permission":
    case "approval":
      // No pending-decision query endpoint — the ledger keeps the clue
      // (the runtime re-prompts through a fresh permission-request event
      // if the answer truly never landed).
      return Promise.resolve("unknown")
    default:
      return Promise.resolve("unknown")
  }
}

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
  // The SSE keepalive loop of the current submission (pi reconnect.ts
  // borrowing). One loop per submission: it owns open/retry/backoff/
  // handshake-timeout/wake-staleness, while this component keeps the
  // token-filtered message handling and the SSE_MAX_RETRIES give-up gate.
  // stopStream() stops the loop alongside the stream, so every lifecycle
  // path (new submit, Stop, workspace switch, unmount) tears both down.
  const keepaliveRef = useRef<SseKeepaliveHandle | null>(null)
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

  // ── Stream commit coalescer (deepseek chat-demo borrowing) ───────────────
  // High-frequency stream frames — full workspace snapshots and delta-class
  // runtime events — buffer in refs and commit ONCE per animation frame
  // (rAF coalescing); control/terminal frames (permission/approval/steering
  // prompts, `done`) apply synchronously. When the tab hides or unloads the
  // browser pauses rAF, so the flusher commits pending deltas synchronously
  // on visibilitychange→hidden / pagehide — otherwise anything accumulated
  // in that window would never paint. Each buffer entry carries the submit
  // token that produced it, so a batch buffered by a stale stream is
  // dropped at commit time instead of leaking into the newer submission.
  const pendingEventsRef = useRef<{ token: number; ev: RuntimeEvent }[]>([])
  const pendingWorkspaceRef = useRef<{ token: number; workspace: Workspace } | null>(null)
  const commitStreamBatch = useCallback(() => {
    const activeToken = tokenRef.current
    const batch = pendingEventsRef.current
    pendingEventsRef.current = []
    const fresh = batch.filter((entry) => entry.token === activeToken)
    if (fresh.length > 0) {
      setEvents((prev) => [...prev, ...fresh.map((entry) => entry.ev)])
    }
    const snapshot = pendingWorkspaceRef.current
    pendingWorkspaceRef.current = null
    if (snapshot && snapshot.token === activeToken) {
      setWorkspace(snapshot.workspace)
    }
  }, [])
  const streamFlusher = useStreamFlusher(commitStreamBatch)

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
    // Stop the keepalive loop FIRST: it closes the current link itself and
    // ignores the close report once stopped, so the explicit stream close
    // below can never read as a lost connection worth retrying.
    keepaliveRef.current?.stop()
    keepaliveRef.current = null
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
    // Commit deltas buffered by the dying stream first (chat-demo settle
    // semantics): after the token bump below, a commit would drop them.
    streamFlusher.flushNow()
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

  // Optimistic-bubble retry transport (OpenHands useSendMessage borrowing,
  // adapted): failed pending bubbles render in ChatPanel, but only this
  // component owns chatApi — and the dock renders ChatPanel, so the retry
  // cannot ride props. The store invokes this transport on the user's
  // Retry click; it routes through the SAME submit path (which skips
  // re-enqueueing for an existing pending id). Re-registered every render
  // (like the ref bridges above) so it always closes over fresh state,
  // and cleared on unmount so a stray retry can't touch a dead component.
  useEffect(() => {
    registerPendingResend((text, pendingId) => {
      void handleSubmit(text, pendingId)
    })
    return () => registerPendingResend(null)
  })

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

  async function handleSubmit(message: string, pendingId?: string) {
    // Cancel any in-flight request and close any open stream first. Without
    // this, rapid clicks on the Send button would open N parallel SSE
    // connections and leak streams when the user navigates away mid-stream.
    abortRef.current?.abort()
    abortRef.current = new AbortController()
    stopStream()

    const myToken = ++tokenRef.current
    setSubmitting(true)
    // Fresh submission — start the consecutive-error count clean (the
    // previous implementation reset it right after opening the stream;
    // reconnects deliberately do NOT reset it, or the 5-consecutive-errors
    // give-up could never trigger).
    sseErrorCount.current = 0

    // Optimistic user message (OpenHands optimistic-user-message-store
    // borrowing): the text renders immediately as a faded "sending" bubble
    // and is consumed by the workspace snapshot echo, so a failed POST no
    // longer loses it (it flips to an error bubble with a retry). A retry
    // of an existing bubble passes its id — no second bubble is enqueued.
    const myPendingId =
      pendingId ?? useOptimisticMessages.getState().enqueue(workspace?.id ?? null, message)
    // Durable uplink ledger (ZCode pendingCommandRegistry borrowing): the
    // reconciliation clue is persisted BEFORE the uplink; a persistence
    // failure refuses the uplink — an untracked send could never be
    // reconciled after a reload.
    if (!pendingUplinks.register(myPendingId, { kind: "chat", payload: { message } })) {
      useOptimisticMessages.getState().markError(myPendingId)
      if (tokenRef.current === myToken) setSubmitting(false)
      return
    }
    try {
      const { workspaceId, status } = await chatApi.chat(message, abortRef.current.signal)
      // The POST response is the ledger's server acknowledgement — applied
      // even when a newer submit has since taken over the UI: THIS uplink
      // was durably accepted regardless of staleness. The optimistic
      // bubble itself stays until the stream echo (the UI-level
      // confirmation in `handleMessage` below).
      pendingUplinks.settle(myPendingId, "accepted")
      if (status === "steered") {
        // Steering receipt: the server folded the message into the running
        // workspace and acked with a receiptId. There is no new workspace
        // snapshot whose userRequest would echo a steered message, so the
        // receipt IS the echo — retire the bubble now.
        useOptimisticMessages.getState().remove(myPendingId)
      } else {
        useOptimisticMessages.getState().bindWorkspace(myPendingId, workspaceId)
      }
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
            const snapshot = data.workspace as Workspace
            // Echo consumption (OpenHands consumeMatchingPendingMessage
            // borrowing): the snapshot carries workspace.userRequest — the
            // server's rendering of the submitted message. A pending
            // optimistic message bound to this workspace whose trimmed
            // content matches is confirmed delivered and leaves the
            // pending queue (a late echo also consumes an errored entry).
            useOptimisticMessages.getState().consumeEcho(snapshot.id, snapshot.userRequest)
            // Snapshot frame: full workspace state, so only the latest one
            // per animation frame matters — buffer and coalesce (deepseek
            // chat-demo borrowing) instead of re-rendering per frame.
            pendingWorkspaceRef.current = { token: myToken, workspace: snapshot }
            streamFlusher.schedule()
          } else if (data.type === "event") {
            const ev = data.event as { type?: string } & Record<string, unknown>
            // Event classification (deepseek chat-demo borrowing): prompts
            // and stream-lifecycle signals must land synchronously (they
            // drive the permission dialog / notifications); every other
            // event is append-only stream data and joins the rAF batch.
            if (typeof ev.type === "string" && STREAM_CONTROL_EVENT_TYPES.has(ev.type)) {
              // Commit buffered deltas first so the timeline keeps stream
              // order, then apply this frame synchronously.
              streamFlusher.flushNow()
              setEvents((prev) => [...prev, ev as RuntimeEvent])
            } else {
              pendingEventsRef.current.push({ token: myToken, ev: ev as RuntimeEvent })
              streamFlusher.schedule()
            }
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
            } else if (ev.type === "steering-applied") {
              // Real notification (notificationStore → ToastHost): a
              // steering wave landed on the running task(s). The timeline
              // already logs it; the durable notification makes it visible
              // outside the workspace tab too.
              notifySteeringApplied(ev.taskIds ?? ev.taskId)
            }
          } else if (data.type === "done") {
            // Terminal frame: commit whatever deltas are still buffered so
            // the tail of the stream paints before the teardown below.
            streamFlusher.flushNow()
            // Tear the stream down. The keepalive loop must stop FIRST —
            // otherwise the close below reads as a lost connection and the
            // loop would re-open the stream this `done` just finished.
            keepaliveRef.current?.stop()
            streamRef.current?.close()
            if (tokenRef.current === myToken) setSubmitting(false)
          }
        } catch (err) {
          console.error("SSE parse error", err)
        }
      }

      // Give-up flag for this submission: once SSE_MAX_RETRIES consecutive
      // transport errors have landed, the keepalive loop's canRetry gate
      // parks it permanently (the UI no longer spins on a permanent
      // failure — 404, 403, repeated 5xx).
      let gaveUp = false

      const handleError = (err: unknown) => {
        // Ignore errors from a stale stream.
        if (tokenRef.current !== myToken) return
        // Surface any deltas buffered before the failure so nothing the
        // user should see sits in the batch across the reconnect.
        streamFlusher.flushNow()
        // The fetch+ReadableStream impl does NOT auto-reconnect like
        // EventSource did. Consecutive transport failures are counted
        // here (token-guarded; reset per message in `handleMessage` and
        // at the start of each fresh submission); the reconnect itself is
        // owned by the keepalive loop, which retries with backoff through
        // its canRetry gate below instead of re-opening immediately.
        sseErrorCount.current += 1
        if (sseErrorCount.current >= SSE_MAX_RETRIES) {
          console.warn(`SSE gave up after ${sseErrorCount.current} consecutive errors`, err)
          gaveUp = true
          // Stop the loop BEFORE the close report lands, so it can't
          // schedule another attempt past the give-up.
          keepaliveRef.current?.stop()
          streamRef.current?.close()
          if (tokenRef.current === myToken) setSubmitting(false)
        } else {
          console.warn(
            `SSE connection error (attempt ${sseErrorCount.current}/${SSE_MAX_RETRIES}, reconnect scheduled by keepalive)`,
            err,
          )
          // During reconnect, KEEP submitting=true so the user knows
          // the workspace is still in-flight. The previous EventSource
          // implementation reset submitting on every transient blip,
          // making the button flicker between disabled and enabled
          // while we were still trying to recover. The loop re-opens
          // through the `open` adapter below with the same handlers
          // once its backoff fires (or immediately on a wake).
        }
      }

      // Stream lifecycle (pi reconnect.ts borrowing): the keepalive loop
      // owns open/retry/backoff/handshake-timeout/wake-staleness for this
      // submission. The token semantics are preserved: every adapter
      // callback filters on `myToken`, and stopStream() stops the loop
      // before any token bump on the lifecycle paths (new submit, Stop,
      // workspace switch, unmount).
      keepaliveRef.current = createSseKeepalive({
        environment: browserEnvironment("workspace-stream"),
        // No continuous silence watch for THIS stream: the server
        // heartbeats with `:` comment frames every 25s, and the SSE
        // decoder drops comments (they never dispatch), so a healthy
        // connection is client-silent for as long as one slow tool call
        // runs — a 25s silence watch would churn-reconnect healthy
        // sockets. Wake-time staleness (STALE_MS) still replaces sockets
        // that died while the page was away. The opencode events stream
        // heartbeats with visible data frames and enables the watch.
        open: (events) => {
          // Token guard: a stale loop's reconnect must never clobber a
          // newer submission's stream. stopStream() stops the loop before
          // the token bump, so this is belt-and-suspenders.
          if (tokenRef.current !== myToken) {
            return { onClose: () => {}, close: () => {} }
          }
          let onClosed: ((reason: string) => void) | undefined
          const handle = openWorkspaceStream(workspaceId, {
            onOpen: () => events.opened(),
            onMessage: (data) => {
              events.received()
              handleMessage(data)
            },
            onError: handleError,
            onClose: () => onClosed?.("connection closed"),
          })
          streamRef.current = handle
          return {
            onClose: (handler) => {
              onClosed = handler
            },
            close: () => handle.close(),
          }
        },
        canRetry: async () => !gaveUp && tokenRef.current === myToken,
        onConnected: (connected) => {
          if (!connected) return
          if (tokenRef.current !== myToken) return
          // (Re)connect success — reconcile the durable uplink ledger
          // (ZCode registry discipline: the server is authoritative; the
          // ledger only ever holds client-side clues).
          void pendingUplinks.reconcile(reconcileUplinkLookup)
        },
      })
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        // Stop button (or a newer submission aborting this POST). We cannot
        // know whether the server processed the message, so the bubble
        // goes to the error state (retry / dismiss — dismiss restores the
        // text to the composer) instead of hanging as "sending" until the
        // watchdog; the ledger clue stays for reconciliation (a client
        // abort is not proof of non-delivery).
        useOptimisticMessages.getState().markError(myPendingId)
        pendingUplinks.settle(myPendingId, "failed")
        return
      }
      console.error("chat error", err)
      stopStream()
      // Optimistic bubble: flip to the error state with the transport
      // message. The text is preserved in the bubble — the pre-optimistic
      // behavior lost it entirely (composer and draft store cleared at
      // submit time).
      useOptimisticMessages
        .getState()
        .markError(myPendingId, err instanceof Error ? err.message : undefined)
      pendingUplinks.settle(myPendingId, "failed")
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
      // Durable uplink ledger (ZCode pendingCommandRegistry borrowing): the
      // decision is registered BEFORE the POST — persistence failure
      // refuses the uplink, because an untracked answer could vanish on a
      // reload while the runtime stays parked on the gate. The entry is
      // sensitive: no plaintext payload is stored (digest only).
      if (!pendingUplinks.register(id, { kind: "permission", sensitive: true })) {
        useNotificationStore.getState().push("error", "shell.notify.permissionFailed")
        return
      }
      try {
        await permissionsApi.answer(id, decision)
        pendingUplinks.settle(id, "accepted")
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
        // Ledger: the client-level failure is not proof of non-delivery —
        // keep the clue (marked failed) for reconnect reconciliation.
        pendingUplinks.settle(id, "failed")
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
      // Durable uplink ledger: same discipline as answerPermission above —
      // the clue is persisted before the POST (sensitive: digest only),
      // persistence failure refuses the uplink, the ACK closes it out.
      if (!pendingUplinks.register(id, { kind: "approval", sensitive: true })) {
        useNotificationStore.getState().push("error", "shell.notify.permissionFailed")
        return
      }
      try {
        await permissionsApi.answerApproval(id, decision, comment)
        pendingUplinks.settle(id, "accepted")
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
        // Ledger: keep the clue for reconciliation (same as permissions).
        pendingUplinks.settle(id, "failed")
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
              {/* The workspace main area is the shell dock: the
                  conversation (submit / stop / mention / drafts) is the
                  resident "chat" leaf — never closable, re-inserted when
                  a stale persisted document lost it — with the live
                  timeline as the second default leaf. The seven-panel
                  sidebar dock keeps its independent persisted tree in the
                  trailing column; sidebarHidden (pref / keyboard toggle)
                  collapses that column without touching either tree. */}
              <WorkspaceDockArea
                workspace={workspace}
                events={events}
                live={submitting}
                submitting={submitting}
                onSubmit={handleSubmit}
                onAbort={abortSubmission}
                mentionSuggestions={mentionSuggestions}
                onOpenProviders={() => setTab("providers")}
                onOpenPalette={() => setCommandOpen(true)}
                onNavigate={setTab}
                onOpenSession={(id) => {
                  if (id && id !== workspace?.id) void pickWorkspace(id)
                }}
                sidebarHidden={sidebarHidden}
                parkedTaskIds={
                  pendingPermissions.size > 0
                    ? new Set(Array.from(pendingPermissions.values()).map((p) => p.taskId))
                    : undefined
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
              <SettingsPanel onOpenWorkspace={pickWorkspace} activeWorkspaceId={workspace?.id} />
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
