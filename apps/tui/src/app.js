import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime"
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
import { initLocale, useLocale, t, localeDisplayName, getLocale } from "@max/i18n"
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
} from "./context"
import { useLiveUsage } from "./hooks/useLiveUsage"
import { formatTokens, formatPercent } from "@max/i18n"
// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------
export async function run(input) {
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
  console.error(`[tui] locale=${resolved} stateDir=${stateDir()}`)
  // OpenCode wraps the whole thing in an `Effect.scoped` to manage cleanup of
  // the renderer, plugin host, audio, and signal handlers. We approximate the
  // lifecycle with a try/finally around `render()`.
  const onExit = (reason) => {
    if (reason !== undefined) {
      console.error(reason)
    }
  }
  try {
    const instance = render(
      _jsx(Root, {
        args: input.args,
        config: input.config,
        url: input.url,
        directory: input.directory,
        token: input.token,
        onExit: onExit,
      }),
    )
    await instance.waitUntilExit()
  } finally {
    try {
      await input.pluginHost.dispose()
    } catch (err) {
      console.error("Failed to dispose TUI plugins", err)
    }
  }
}
function Root(props) {
  return _jsx(ExitProvider, {
    exit: props.onExit,
    children: _jsx(ReactErrorBoundary, {
      fallback: ({ error, reset }) =>
        _jsx(ErrorComponent, { error: error, reset: reset, mode: "dark" }),
      children: _jsx(ClipboardProvider, {
        children: _jsx(ArgsProvider, {
          value: props.args,
          children: _jsx(KVProvider, {
            children: _jsx(ToastProvider, {
              children: _jsx(RouteProvider, {
                children: _jsx(SDKProvider, {
                  url: props.url,
                  directory: props.directory,
                  token: props.token,
                  children: _jsx(ThemeProvider, {
                    mode: "dark",
                    children: _jsx(DialogProvider, {
                      children: _jsx(PluginRuntimeProvider, {
                        children: _jsx(App, { config: props.config }),
                      }),
                    }),
                  }),
                }),
              }),
            }),
          }),
        }),
      }),
    }),
  })
}
class ReactErrorBoundary extends React.Component {
  state = { error: null }
  static getDerivedStateFromError(error) {
    return { error }
  }
  componentDidCatch(error) {
    console.error("TUI fatal error", error)
  }
  reset = () => {
    this.setState({ error: null })
  }
  render() {
    if (this.state.error !== null) {
      const Fallback = this.props.fallback
      return _jsx(Fallback, { error: this.state.error, reset: this.reset })
    }
    return this.props.children
  }
}
function App({ config }) {
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
      _jsx(DialogLanguageList, {
        onSelect: (locale) => {
          toast.show({
            variant: "info",
            message: t("tui.languageSwitched", { locale: localeDisplayName(locale) }),
            duration: 2000,
          })
        },
      }),
      { size: "medium" },
    )
  }
  // Lightweight terminal title effect — only runs when the route changes and
  // terminal title is enabled. The actual `process.stdout` write is gated by
  // the `terminalTitleEnabled` flag, mirroring OpenCode's behaviour.
  React.useEffect(() => {
    if (!terminalTitleEnabled) return
    const data = route.data
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
    // ctrl+l opens the language picker. It must NOT be bound to a bare "/"
    // — every keystroke reaches every useInput handler in ink, so a global
    // "/" keybind would pop the dialog on the way to the prompt and the
    // user could never type a leading slash. ctrl+l doesn't collide with
    // typing and keeps the picker reachable without a session (the
    // command palette is still a stub and slash commands need a session).
    if (key.ctrl && input === "l") {
      openLanguageDialog()
    }
  })
  const routeData = route.data
  return _jsxs(Box, {
    flexDirection: "column",
    width: "100%",
    children: [
      ready
        ? _jsxs(Box, {
            flexGrow: 1,
            flexDirection: "column",
            children: [
              routeData.type === "home"
                ? _jsx(Home, {})
                : routeData.type === "session"
                  ? _jsx(Session, { sessionID: routeData.sessionID })
                  : routeData.type === "plugin"
                    ? _jsx(PluginRoute, { id: routeData.id })
                    : _jsx(Text, { children: t("tui.unknownRoute") }),
              _jsx(Box, {
                flexShrink: 0,
                children: _jsx(pluginRuntime.Slot, { name: "app_bottom" }),
              }),
              _jsx(pluginRuntime.Slot, { name: "app" }),
            ],
          })
        : null,
      _jsx(StartupLoading, { ready: ready }),
      _jsx(Text, { children: " " }),
      void theme,
      void exit,
    ],
  })
}
// ---------------------------------------------------------------------------
// Route placeholders — the real Home / Session routes will be ported later.
// ---------------------------------------------------------------------------
function Home() {
  useLocale()
  const theme = useTheme()
  const sdk = useSDK()
  const [health, setHealth] = React.useState(null)
  const [executions, setExecutions] = React.useState([])
  const [pending, setPending] = React.useState([])
  const [usage, setUsage] = React.useState(null)
  const [error, setError] = React.useState(null)
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
          sdk.client.get("/api/health"),
          sdk.client.get("/api/obs/executions"),
          sdk.client.get("/api/gov/pending"),
          sdk.client.get("/api/obs/usage/summary?range=today"),
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
  return _jsxs(Box, {
    flexDirection: "column",
    paddingLeft: 1,
    paddingRight: 1,
    children: [
      _jsx(Text, { bold: true, color: theme.theme.text, children: "Maximilian" }),
      loading
        ? _jsxs(Text, {
            color: theme.theme.textMuted,
            children: ["Connecting to ", sdk.url, "\u2026"],
          })
        : error
          ? _jsxs(Text, { color: "red", children: ["Failed to load: ", error] })
          : _jsxs(_Fragment, {
              children: [
                _jsx(HealthRow, { health: health }),
                _jsx(UsageRow, { usage: usage }),
                _jsx(PendingRow, { pending: pending }),
                _jsx(ExecutionsRow, { executions: executions }),
                _jsx(LiveUsageBar, {}),
              ],
            }),
      _jsx(Text, {
        color: theme.theme.textMuted,
        children: "Press ctrl+l to change language \u00B7 ctrl+\\ for the command palette (stub).",
      }),
    ],
  })
}
function HealthRow({ health }) {
  useLocale()
  if (!health) return null
  const ok = health.status === "ok"
  return _jsxs(Box, {
    marginTop: 1,
    children: [
      _jsxs(Text, { color: ok ? "green" : "yellow", children: [ok ? "●" : "○", " "] }),
      _jsxs(Text, {
        children: [
          "API ",
          health.status,
          " \u00B7 providers:",
          " ",
          health.providers.map((p) => p.id).join(", ") || t("common.none"),
          " \u00B7 evolution:",
          " ",
          health.evolution,
        ],
      }),
    ],
  })
}
function UsageRow({ usage }) {
  useLocale()
  if (!usage) return null
  return _jsxs(Box, {
    marginTop: 1,
    flexDirection: "column",
    children: [
      _jsx(Text, { bold: true, children: t("tui.today") }),
      _jsxs(Text, {
        children: [
          " ",
          "requests: ",
          usage.totalRequests,
          " \u00B7 cost:",
          " ",
          usage.totalCostUsdKnown === false ? "\u2014" : `$${usage.totalCostUsd.toFixed(4)}`,
          " \u00B7 success:",
          " ",
          (usage.successRate * 100).toFixed(1),
          "%",
        ],
      }),
      _jsxs(Text, {
        children: [
          " ",
          "tokens: ",
          usage.realTotalTokens.toLocaleString(),
          " (cache hit",
          " ",
          (usage.cacheHitRate * 100).toFixed(1),
          "%)",
        ],
      }),
      usage.unpricedRequestCount > 0 &&
        _jsxs(Text, {
          color: "red",
          children: [
            " ",
            "\u26A0 ",
            usage.unpricedRequestCount,
            " unpriced request(s) \u2014 pricing table missing entry",
          ],
        }),
    ],
  })
}
function PendingRow({ pending }) {
  useLocale()
  if (pending.length === 0) return null
  return _jsxs(Box, {
    marginTop: 1,
    flexDirection: "column",
    children: [
      _jsxs(Text, {
        bold: true,
        color: "yellow",
        children: ["Pending governance (", pending.length, ")"],
      }),
      pending.slice(0, 3).map((p) =>
        _jsxs(
          Text,
          {
            children: [
              " ",
              p.proposal.action,
              " ",
              p.proposal.subject,
              " \u00B7 utility ",
              p.score.utility.toFixed(2),
            ],
          },
          p.proposalId,
        ),
      ),
    ],
  })
}
function ExecutionsRow({ executions }) {
  useLocale()
  if (executions.length === 0) return null
  return _jsxs(Box, {
    marginTop: 1,
    flexDirection: "column",
    children: [
      _jsx(Text, { bold: true, children: t("tui.recentExecutions") }),
      executions.map((e) =>
        _jsxs(
          Text,
          {
            children: [
              " ",
              "[",
              e.status,
              "] ",
              e.userPrompt.slice(0, 60),
              e.userPrompt.length > 60 ? "…" : "",
            ],
          },
          e.id,
        ),
      ),
    ],
  })
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
    return _jsx(Box, {
      marginTop: 1,
      children: _jsx(Text, { color: "gray", children: "\u00B7 \uD83D\uDCB0 \u2026 loading usage" }),
    })
  }
  if (!data || data.totalRequests === 0) {
    return _jsx(Box, {
      marginTop: 1,
      children: _jsx(Text, {
        color: "gray",
        children: "\u00B7 \uD83D\uDCB0 $0.0000 \u00B7 0 tok today",
      }),
    })
  }
  return _jsx(Box, {
    marginTop: 1,
    children: _jsxs(Text, {
      color: isError ? "red" : "green",
      children: [
        "\u00B7 \uD83D\uDCB0 ",
        data.totalCostUsdKnown === false ? "\u2014" : `$${data.totalCostUsd.toFixed(4)}`,
        " \u00B7 ",
        formatTokens(data.totalTokens),
        " tok",
        data.cacheHitRate > 0 ? ` · ${formatPercent(data.cacheHitRate, 0)} cache` : "",
        isError ? " (stale)" : "",
      ],
    }),
  })
}
function Session({ sessionID }) {
  useLocale()
  const theme = useTheme()
  return _jsxs(Box, {
    flexDirection: "column",
    paddingLeft: 1,
    paddingRight: 1,
    children: [
      _jsxs(Text, { bold: true, color: theme.theme.text, children: ["Session ", sessionID] }),
      _jsx(Text, { color: theme.theme.textMuted, children: t("tui.sessionRouteStub") }),
    ],
  })
}
function PluginRoute({ id }) {
  useLocale()
  const pluginRuntime = usePluginRuntime()
  const Render = pluginRuntime.routes.get(id)
  if (Render) {
    return _jsx(Render, {})
  }
  return _jsx(Box, {
    paddingLeft: 1,
    paddingRight: 1,
    children: _jsxs(Text, { color: "yellow", children: ["Plugin route not found: ", id] }),
  })
}
// Reference useApp so the import isn't dropped during refactors; the hook is
// also useful for child components that need an explicit exit path.
void useApp
export default App
