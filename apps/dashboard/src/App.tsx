import { Suspense, lazy, useState, useEffect, useRef, useCallback } from "react"
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
import type { Workspace, RuntimeEvent } from "./api"
import { ChatPanel } from "./components/ChatPanel"
import { AgentPanel } from "./components/AgentPanel"
import { TaskPanel } from "./components/TaskPanel"
import { OutputPanel } from "./components/OutputPanel"
import { ReviewPanel } from "./components/ReviewPanel"
import { ThemeToggle } from "./components/ThemeToggle"
import { LocaleSwitcher } from "./components/LocaleSwitcher"
import { LiveUsagePill } from "./components/LiveUsagePill"
import { PermissionDialog } from "./components/PermissionDialog"
import { AppCommandPalette } from "./components/AppCommandPalette"
import { permissionsApi, type PendingPermission } from "./lib/permissions"
import { usePerfTier } from "./lib/perf-tier"
import { useTheme } from "./lib/theme"

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

  // Workspace state
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [events, setEvents] = useState<RuntimeEvent[]>([])
  const [submitting, setSubmitting] = useState(false)
  const esRef = useRef<EventSource | null>(null)
  // Used to cancel an in-flight POST when the user re-submits. SSE itself
  // can't be aborted (browser API doesn't allow it), but the chat request
  // can, and we close the previous EventSource in stopStream().
  const abortRef = useRef<AbortController | null>(null)
  // Latest un-answered permission prompt. We track the requestId so the
  // answer call always pairs with the event the user actually saw.
  const [pendingPermission, setPendingPermission] = useState<PendingPermission | null>(null)
  // Consecutive error count for the current EventSource. The browser
  // auto-reconnects on transient failure and resends `Last-Event-ID` so the
  // server can replay missed events — but for permanent failures (404,
  // 403, repeated 5xx) we cap retries and close the stream so the UI
  // doesn't spin forever.
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

  const stopStream = useCallback(() => {
    if (esRef.current) {
      esRef.current.close()
      esRef.current = null
    }
  }, [])

  // Abort the in-flight submission + close the SSE stream. Bound to the
  // Stop button in ChatPanel. Note: this does NOT cancel the server-side
  // workspace execution — the backend has no cancel endpoint yet. The
  // orphaned workspace continues running and its events fire into the
  // void (no subscriber); the user's UI clears and they can start fresh.
  const abortSubmission = useCallback(() => {
    abortRef.current?.abort()
    stopStream()
    // Bump the token so any pending `es.onmessage` / `es.onerror` from
    // the old stream short-circuits (line 130/201) without flipping
    // `submitting` after we've already cleared it below.
    tokenRef.current++
    setSubmitting(false)
  }, [stopStream])

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
      }
    },
    [stopStream],
  )

  async function handleSubmit(message: string) {
    // Cancel any in-flight request and close any open stream first. Without
    // this, rapid clicks on the Send button would open N parallel SSE
    // connections and leak EventSources when the user navigates away mid-stream.
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

      const es = openWorkspaceStream(workspaceId)
      esRef.current = es
      sseErrorCount.current = 0

      es.onmessage = (e) => {
        // Ignore messages from a stale stream (a newer submit replaced us).
        if (tokenRef.current !== myToken) return
        // A successful message resets the retry counter — the connection
        // is healthy and we should tolerate the next transient failure.
        sseErrorCount.current = 0
        try {
          const data = JSON.parse(e.data)
          if (data.type === "workspace") {
            setWorkspace(data.workspace)
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
              setPendingPermission({
                kind: "permission",
                requestId,
                workspaceId: strField("workspaceId") ?? "",
                taskId: strField("taskId") ?? "",
                tool: strField("tool") ?? "",
                target: strField("target") ?? "",
                input: ev.input ?? undefined,
              })
            } else if (ev.type === "permission-resolved") {
              const requestId = strField("requestId")
              if (!requestId) return
              setPendingPermission((p) => (p && p.requestId === requestId ? null : p))
            } else if (ev.type === "approval-request") {
              const requestId = strField("requestId")
              if (!requestId) return
              setPendingPermission({
                kind: "approval",
                requestId,
                workspaceId: strField("workspaceId") ?? "",
                taskId: strField("taskId") ?? "",
                prompt: strField("prompt") ?? "",
                reason: strField("reason"),
                requireComment: boolField("requireComment"),
              })
            } else if (ev.type === "approval-resolved") {
              const requestId = strField("requestId")
              if (!requestId) return
              setPendingPermission((p) => (p && p.requestId === requestId ? null : p))
            }
          } else if (data.type === "done") {
            // Detach onerror before close: closing the EventSource fires a
            // final ERROR event which would otherwise re-enter our onerror
            // and double-flip submitting.
            es.onerror = null
            es.close()
            if (esRef.current === es) esRef.current = null
            // Reset submitting only if this submit is still the active one.
            if (tokenRef.current === myToken) setSubmitting(false)
          }
        } catch (err) {
          console.error("SSE parse error", err)
        }
      }

      es.onerror = () => {
        // Ignore errors from a stale stream.
        if (tokenRef.current !== myToken) return
        // The browser's EventSource auto-reconnects after a transient
        // failure and resends `Last-Event-ID` so the server can replay
        // missed events. We let it retry up to SSE_MAX_RETRIES; beyond
        // that we close the stream so the UI doesn't spin forever on a
        // permanent failure (404, 403, repeated 5xx).
        sseErrorCount.current += 1
        if (sseErrorCount.current >= SSE_MAX_RETRIES) {
          console.warn(`SSE gave up after ${sseErrorCount.current} consecutive errors`)
          if (esRef.current === es) {
            es.onerror = null
            es.close()
            esRef.current = null
          }
          // Only flip submitting off if we're still the current submit.
          if (tokenRef.current === myToken) setSubmitting(false)
        } else {
          console.warn(
            `SSE connection error (auto-reconnecting, attempt ${sseErrorCount.current}/${SSE_MAX_RETRIES})`,
          )
          // During auto-reconnect, KEEP submitting=true so the user knows
          // the workspace is still in-flight. Previously this branch reset
          // submitting on every transient blip, making the button flicker
          // between disabled and enabled while the browser was still
          // trying to recover.
        }
      }
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
      if (!pendingPermission || pendingPermission.kind !== "permission") return
      const id = pendingPermission.requestId
      try {
        await permissionsApi.answer(id, decision)
        // Close the dialog only after the server has acknowledged the
        // answer. The previous implementation always cleared in
        // `finally`, which meant a network/server error would silently
        // dismiss the prompt — the user thinks they answered, but the
        // backend never received the decision and the next tool call
        // will re-prompt (now with no UX indication that the previous
        // attempt failed).
        setPendingPermission(null)
      } catch (err) {
        console.error("[perms] answer failed", err)
        // Leave the dialog open so the user can retry. A subsequent
        // permission-resolved event (if the request actually did
        // reach the server) is idempotent and still closes the
        // dialog via the SSE handler.
      }
    },
    [pendingPermission],
  )

  const answerApproval = useCallback(
    async (decision: "approve" | "reject", comment?: string) => {
      if (!pendingPermission || pendingPermission.kind !== "approval") return
      const id = pendingPermission.requestId
      try {
        await permissionsApi.answerApproval(id, decision, comment)
        // Same reasoning as answerPermission above: only close on
        // server acknowledgement so a failed POST doesn't leave the
        // user thinking their decision was recorded.
        setPendingPermission(null)
      } catch (err) {
        console.error("[approvals] answer failed", err)
      }
    },
    [pendingPermission],
  )

  // Cmd/Ctrl+K opens the command palette. Bound at the App level so it works
  // regardless of which tab is active. Skipped when typing in an input,
  // textarea, or contenteditable so the keystroke isn't hijacked while the
  // user is editing.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "k") return
      // Reject when other modifier keys are also pressed (Shift / Alt) so the
      // shortcut doesn't hijack combinations the OS or other apps reserve
      // (e.g. Cmd+Shift+K is bound by many browsers / terminals).
      if (e.altKey || e.shiftKey) return
      const target = e.target as Element | null
      if (target) {
        const tag = target.tagName.toLowerCase()
        if (tag === "input" || tag === "textarea" || (target as HTMLElement).isContentEditable) {
          return
        }
      }
      e.preventDefault()
      setCommandOpen((prev) => !prev)
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
      <PermissionDialog
        pending={pendingPermission}
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
          {healthError ? (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <span className="inline-block w-2 h-2 rounded-full bg-destructive" />
              <span>{t("app.backendUnreachable")}</span>
            </div>
          ) : health ? (
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <span
                className={`inline-block w-2 h-2 rounded-full ${health.status === "ok" ? "bg-green-500" : "bg-destructive"}`}
              />
              <span>{t("app.footer.telemetry", { telemetry: health.telemetry })}</span>
              <span>{t("app.footer.meta", { meta: health.metaAgent })}</span>
              <span>{t("app.footer.providersCount", { count: health.providers.length })}</span>
            </div>
          ) : null}
          <LiveUsagePill onOpenUsage={() => setTab("usage")} />
          <LocaleSwitcher />
          <ThemeToggle />
        </div>
      </header>

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
                sidebar={
                  <div className="flex flex-col gap-4">
                    <AgentPanel
                      workspace={workspace}
                      parkedTaskIds={
                        pendingPermission ? new Set([pendingPermission.taskId]) : undefined
                      }
                    />
                    <TaskPanel workspace={workspace} />
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
              <ExecutionCanvas />
            </Suspense>
          </TabsContent>
          <TabsContent value="governance">
            <Suspense fallback={<TabFallback label={t("nav.governance")} />}>
              <GovernancePortal />
            </Suspense>
          </TabsContent>
          <TabsContent value="evolution">
            <Suspense fallback={<TabFallback label={t("nav.evolution")} />}>
              <EvolutionTree />
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
