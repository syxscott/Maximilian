// Port of OpenCode's `app.tsx` to React 19 + ink.
//
// OpenCode's app is a 1100-line component tree that depends on a deep
// provider stack (theme, route, SDK, sync, project, dialog, keymap, plugin
// runtime, toast, KV, ...). The Maximilian TUI port reproduces the *shape* of
// that provider stack and the high-level App component, but every context it
// needs is stubbed out via lightweight placeholders under `./context/*`.
// Those stubs will be replaced as the Maximilian contexts are wired up in
// subsequent ports — see `./context/index.tsx` for the export list.
//
// Public API preserved from OpenCode:
//   - `run(input)` boots the TUI with an Effect-style run loop
//   - the top-level App component renders routes ("home" | "session" |
//     "plugin") and shows a startup spinner until plugin hosts signal ready

import React from "react"
import { Box, Text, render, useApp, useInput } from "ink"
import { initLocale, useLocale, t, localeDisplayName, getLocale, setLocale } from "@max/i18n"
import { readLocaleFile, writeLocaleFile, removeLocaleFile, stateDir } from "./util/locale-file"

import { ErrorComponent } from "./components/error-component"
import { StartupLoading } from "./components/startup-loading"
import { DialogProvider } from "./components/dialog"
import { ToastProvider } from "./components/toast"
import { DialogLanguageList } from "./components/dialog-language-list"
import { appendCommandPaletteCommands } from "./command-palette"
import {
  ClipboardProvider,
  ArgsProvider,
  KVProvider,
  RouteProvider,
  useRoute,
  SDKProvider,
  useSDK,
  ThemeProvider,
  ExitProvider,
  useExit,
  PluginRuntimeProvider,
  usePluginRuntime,
  useTheme,
  useToast,
  useDialog,
  type Args,
  type TuiConfig,
  type PluginHost,
  type Route,
} from "./context"
import { useLiveUsage } from "./hooks/useLiveUsage"
import { formatTokens, formatPercent } from "@max/i18n"
import { type ExecutionTrace, type Health, type PendingProposal, type UsageSummary } from "./api"

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type TuiInput = {
  url: string
  args: Args
  config: TuiConfig["Resolved"]
  onSnapshot?: () => Promise<string[]>
  directory?: string
  fetch?: typeof fetch
  headers?: RequestInit["headers"]
  events?: { subscribe: (handler: (event: unknown) => void) => Promise<() => void> }
  token?: string
  pluginHost: PluginHost
}

export type { Args, TuiConfig }

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function run(input: TuiInput): Promise<void> {
  // Resolve the locale from CLI/env/storage before mounting the React tree so
  // the first paint already uses the right language. The TUI has no
  // localStorage, so we wire file-based persistence: MAXIMILIAN_LOCALE env var
  // wins, then <stateDir>/locale, then $LANG / system default. Subsequent
  // `setLocale()` calls persist to the same file via the installed persisters.
  const resolved = initLocale({
    loadFrom: () => process.env.MAXIMILIAN_LOCALE ?? readLocaleFile(),
    saveTo: writeLocaleFile,
    removeOnReset: removeLocaleFile,
  })
  // Surface where we ended up reading from — operators debugging "why is
  // my TUI in Chinese" need this hint in stderr.
  // eslint-disable-next-line no-console
  console.error(`[tui] locale=${resolved} stateDir=${stateDir()}`)

  // OpenCode wraps the whole thing in an `Effect.scoped` to manage cleanup of
  // the renderer, plugin host, audio, and signal handlers. We approximate the
  // lifecycle with a try/finally around `render()`.
  const onExit = (reason?: unknown) => {
    if (reason !== undefined) {
      // eslint-disable-next-line no-console
      console.error(reason)
    }
  }

  try {
    const instance = render(
      <Root
        args={input.args}
        config={input.config}
        url={input.url}
        directory={input.directory}
        token={input.token}
        onExit={onExit}
      />,
    )
    await instance.waitUntilExit()
  } finally {
    try {
      await input.pluginHost.dispose()
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("Failed to dispose TUI plugins", err)
    }
  }
}

// ---------------------------------------------------------------------------
// Root component — provider stack + ErrorBoundary analogue
// ---------------------------------------------------------------------------

interface RootProps {
  args: Args
  config: TuiConfig["Resolved"]
  url: string
  directory?: string
  token?: string
  onExit(reason?: unknown): void
}

function Root(props: RootProps) {
  return (
    <ExitProvider exit={props.onExit}>
      <ReactErrorBoundary
        fallback={({ error, reset }) => (
          <ErrorComponent error={error as Error} reset={reset} mode="dark" />
        )}
      >
        <ClipboardProvider>
          <ArgsProvider value={props.args}>
            <KVProvider>
              <ToastProvider>
                <RouteProvider>
                  <SDKProvider url={props.url} directory={props.directory} token={props.token}>
                    <ThemeProvider mode="dark">
                      <DialogProvider>
                        <PluginRuntimeProvider>
                          <App config={props.config} />
                        </PluginRuntimeProvider>
                      </DialogProvider>
                    </ThemeProvider>
                  </SDKProvider>
                </RouteProvider>
              </ToastProvider>
            </KVProvider>
          </ArgsProvider>
        </ClipboardProvider>
      </ReactErrorBoundary>
    </ExitProvider>
  )
}

// ---------------------------------------------------------------------------
// ErrorBoundary (class component is the idiomatic React 19 API; the function
// alternative via `useErrorBoundary` is still experimental in 19.0).
// ---------------------------------------------------------------------------

interface ErrorBoundaryProps {
  fallback: React.ComponentType<{ error: unknown; reset: () => void }>
  children: React.ReactNode
}

interface ErrorBoundaryState {
  error: unknown | null
}

class ReactErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error }
  }

  override componentDidCatch(error: unknown) {
    // eslint-disable-next-line no-console
    console.error("TUI fatal error", error)
  }

  reset = () => {
    this.setState({ error: null })
  }

  override render() {
    if (this.state.error !== null) {
      const Fallback = this.props.fallback
      return <Fallback error={this.state.error} reset={this.reset} />
    }
    return this.props.children
  }
}

// ---------------------------------------------------------------------------
// App — route switching, ready signal, command palette, terminal title
// ---------------------------------------------------------------------------

interface AppProps {
  config: TuiConfig["Resolved"]
}

function App({ config }: AppProps) {
  // Subscribe to locale changes so any string below re-renders on switch.
  useLocale()
  const route = useRoute()
  const theme = useTheme()
  const dialog = useDialog()
  const toast = useToast()
  const pluginRuntime = usePluginRuntime()
  const exit = useExit()

  // `config` is the resolved TUI config; we keep it as a prop for future
  // keybinding wiring.
  void config
  void dialog

  const [ready, setReady] = React.useState(false)
  const [terminalTitleEnabled, setTerminalTitleEnabled] = React.useState(true)

  // Mark the app ready once we've mounted; the OpenCode port waits for the
  // plugin host to start, but in this stubbed version we use a microtask.
  React.useEffect(() => {
    const id = setTimeout(() => setReady(true), 100)
    return () => clearTimeout(id)
  }, [])

  // Register the /language slash command into the command palette so users
  // can find it via ctrl+\ too (not just by typing `/` directly).
  React.useEffect(() => {
    appendCommandPaletteCommands([
      {
        name: "language",
        title: t("tui.language"),
        category: "settings",
        suggested: true,
        onSelect: () => openLanguageDialog(),
      },
    ])
    // We intentionally re-register on every locale change so the title text
    // follows the active language.
  }, [getLocale()])

  function openLanguageDialog() {
    dialog.replace(
      <DialogLanguageList
        onSelect={(locale) => {
          toast.show({
            variant: "info",
            message: t("tui.languageSwitched", { locale: localeDisplayName(locale) }),
            duration: 2000,
          })
        }}
      />,
      { size: "medium" },
    )
  }

  // Lightweight terminal title effect — only runs when the route changes and
  // terminal title is enabled. The actual `process.stdout` write is gated by
  // the `terminalTitleEnabled` flag, mirroring OpenCode's behaviour.
  React.useEffect(() => {
    if (!terminalTitleEnabled) return
    const data = route.data as Route
    const title =
      data.type === "home"
        ? "Maximilian"
        : data.type === "session"
          ? "Maximilian | Session"
          : data.type === "plugin"
            ? `Maximilian | ${data.id}`
            : "Maximilian"
    if (process.stdout.isTTY) {
      process.stdout.write(`\x1b]0;${title}\x07`)
    }
  }, [route.data, terminalTitleEnabled])

  // Mirror OpenCode's command palette toggle: pressing ctrl+\ opens the
  // palette. We don't have a real CommandPaletteDialog in this port, so we
  // emit a toast to confirm the binding is wired.
  useInput((input, key) => {
    if (key.ctrl && input === "\\") {
      toast.show({ variant: "info", message: "Command palette (stub)", duration: 1500 })
    }
    if (key.ctrl && input === "t") {
      setTerminalTitleEnabled((prev) => !prev)
    }
    // `/language` slash command: opens the language picker dialog. Mirrors the
    // `/theme` convention used by OpenCode's command palette.
    if (input === "/") {
      openLanguageDialog()
    }
  })

  const routeData = route.data as Route

  return (
    <Box flexDirection="column" width="100%">
      {ready ? (
        <Box flexGrow={1} flexDirection="column">
          {routeData.type === "home" ? (
            <Home />
          ) : routeData.type === "session" ? (
            <Session sessionID={routeData.sessionID} />
          ) : routeData.type === "plugin" ? (
            <PluginRoute id={routeData.id} />
          ) : (
            <Text>{t("tui.unknownRoute")}</Text>
          )}
          <Box flexShrink={0}>
            <pluginRuntime.Slot name="app_bottom" />
          </Box>
          <pluginRuntime.Slot name="app" />
        </Box>
      ) : null}
      <StartupLoading ready={ready} />
      {/* `theme` is consumed indirectly via its colors; the variable keeps the
          import alive and is available for further wiring. */}
      <Text> </Text>
      {void theme}
      {void exit}
    </Box>
  )
}

// ---------------------------------------------------------------------------
// Route placeholders — the real Home / Session routes will be ported later.
// ---------------------------------------------------------------------------

function Home() {
  useLocale()
  const theme = useTheme()
  const sdk = useSDK()
  const [health, setHealth] = React.useState<Health | null>(null)
  const [executions, setExecutions] = React.useState<ExecutionTrace[]>([])
  const [pending, setPending] = React.useState<PendingProposal[]>([])
  const [usage, setUsage] = React.useState<UsageSummary | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    const ctrl = new AbortController()

    async function load() {
      setLoading(true)
      setError(null)
      try {
        // The SDK client already carries the auth header (ADMIN_TOKEN / JWT)
        // wired in `context/sdk.tsx` — we just call the typed endpoints.
        const [h, exec, gov, sum] = await Promise.all([
          sdk.client.get<Health>("/api/health"),
          sdk.client.get<{ count: number; executions: ExecutionTrace[] }>("/api/obs/executions"),
          sdk.client.get<{ count: number; proposals: PendingProposal[] }>("/api/gov/pending"),
          sdk.client.get<UsageSummary>("/api/obs/usage/summary?range=today"),
        ])
        if (ctrl.signal.aborted) return
        setHealth(h)
        setExecutions(exec.executions.slice(0, 5))
        setPending(gov.proposals)
        setUsage(sum)
      } catch (err) {
        if (!ctrl.signal.aborted) {
          setError(err instanceof Error ? err.message : String(err))
        }
      } finally {
        if (!ctrl.signal.aborted) setLoading(false)
      }
    }
    void load()
    return () => ctrl.abort()
  }, [sdk.url, sdk.directory])

  return (
    <Box flexDirection="column" paddingLeft={1} paddingRight={1}>
      <Text bold color={theme.theme.text}>
        Maximilian
      </Text>
      {loading ? (
        <Text color={theme.theme.textMuted}>Connecting to {sdk.url}…</Text>
      ) : error ? (
        <Text color="red">Failed to load: {error}</Text>
      ) : (
        <>
          <HealthRow health={health} />
          <UsageRow usage={usage} />
          <PendingRow pending={pending} />
          <ExecutionsRow executions={executions} />
          <LiveUsageBar />
        </>
      )}
      <Text color={theme.theme.textMuted}>Press / for language, ctrl+\ for the command palette (stub).</Text>
    </Box>
  )
}

function HealthRow({ health }: { health: Health | null }) {
  useLocale()
  if (!health) return null
  const ok = health.status === "ok"
  return (
    <Box marginTop={1}>
      <Text color={ok ? "green" : "yellow"}>{ok ? "●" : "○"} </Text>
      <Text>API {health.status} · providers: {health.providers.map((p) => p.id).join(", ") || t("common.none")} · evolution: {health.evolution}</Text>
    </Box>
  )
}

function UsageRow({ usage }: { usage: UsageSummary | null }) {
  useLocale()
  if (!usage) return null
  return (
    <Box marginTop={1} flexDirection="column">
      <Text bold>{t("tui.today")}</Text>
      <Text>  requests: {usage.totalRequests} · cost: ${usage.totalCostUsd.toFixed(4)} · success: {(usage.successRate * 100).toFixed(1)}%</Text>
      <Text>  tokens: {usage.realTotalTokens.toLocaleString()} (cache hit {(usage.cacheHitRate * 100).toFixed(1)}%)</Text>
      {usage.unpricedRequestCount > 0 && (
        <Text color="red">  ⚠ {usage.unpricedRequestCount} unpriced request(s) — pricing table missing entry</Text>
      )}
    </Box>
  )
}

function PendingRow({ pending }: { pending: PendingProposal[] }) {
  useLocale()
  if (pending.length === 0) return null
  return (
    <Box marginTop={1} flexDirection="column">
      <Text bold color="yellow">Pending governance ({pending.length})</Text>
      {pending.slice(0, 3).map((p) => (
        <Text key={p.proposalId}>  {p.proposal.action} {p.proposal.subject} · utility {p.score.utility.toFixed(2)}</Text>
      ))}
    </Box>
  )
}

function ExecutionsRow({ executions }: { executions: ExecutionTrace[] }) {
  useLocale()
  if (executions.length === 0) return null
  return (
    <Box marginTop={1} flexDirection="column">
      <Text bold>{t("tui.recentExecutions")}</Text>
      {executions.map((e) => (
        <Text key={e.id}>  [{e.status}] {e.userPrompt.slice(0, 60)}{e.userPrompt.length > 60 ? "…" : ""}</Text>
      ))}
    </Box>
  )
}

// Live usage bar — mirrors the dashboard's LiveUsagePill. Polls the same
// `/api/obs/usage/summary?range=today` endpoint every 30s and renders a
// single bottom line: `· 💰 $X.XXXX · XX.XK tok · 45% cache`.
//
// On the first poll we render a muted placeholder so the home view doesn't
// shift height once data arrives. On subsequent poll failures we keep the
// last known value visible and flip the colour to red so the user knows
// the snapshot is stale.
function LiveUsageBar() {
  useLocale()
  const { data, isLoading, isError } = useLiveUsage()
  if (isLoading && !data) {
    return (
      <Box marginTop={1}>
        <Text color="gray">· 💰 … loading usage</Text>
      </Box>
    )
  }
  if (!data || data.totalRequests === 0) {
    return (
      <Box marginTop={1}>
        <Text color="gray">· 💰 $0.0000 · 0 tok today</Text>
      </Box>
    )
  }
  return (
    <Box marginTop={1}>
      <Text color={isError ? "red" : "green"}>
        · 💰 ${data.totalCostUsd.toFixed(4)} · {formatTokens(data.totalTokens)} tok
        {data.cacheHitRate > 0 ? ` · ${formatPercent(data.cacheHitRate, 0)} cache` : ""}
        {isError ? " (stale)" : ""}
      </Text>
    </Box>
  )
}

function Session({ sessionID }: { sessionID: string }) {
  useLocale()
  const theme = useTheme()
  return (
    <Box flexDirection="column" paddingLeft={1} paddingRight={1}>
      <Text bold color={theme.theme.text}>
        Session {sessionID}
      </Text>
      <Text color={theme.theme.textMuted}>{t("tui.sessionRouteStub")}</Text>
    </Box>
  )
}

function PluginRoute({ id }: { id: string }) {
  useLocale()
  const pluginRuntime = usePluginRuntime()
  const Render = pluginRuntime.routes.get(id)
  if (Render) {
    return <Render />
  }
  return (
    <Box paddingLeft={1} paddingRight={1}>
      <Text color="yellow">Plugin route not found: {id}</Text>
    </Box>
  )
}

// Reference useApp so the import isn't dropped during refactors; the hook is
// also useful for child components that need an explicit exit path.
void useApp

export default App