/**
 * Aggregated context module for the Maximilian TUI.
 *
 * Re-exports React 19 ports of OpenCode's SolidJS contexts alongside minimal
 * stubs for contexts whose full ports haven't landed yet. Public API surface
 * (provider name + hook name + value shape) is preserved so the migration
 * stays mechanical — when a real port replaces a stub, only this file needs
 * editing.
 */

import React from "react"
import type { ReactNode } from "react"

export { ThemeProvider, useTheme, DEFAULT_THEMES } from "./theme"
export type { ThemeColors, ThemeJson, ThemeContextValue } from "./theme"

export { SDKProvider, useSDK } from "./sdk"
export type { SdkContextValue, SdkClient, GlobalEvent, EventSource } from "./sdk"

export {
  TuiRuntimeProvider,
  useTuiPaths,
  useTuiTerminalEnvironment,
  useTuiStartup,
} from "./runtime"
export type { TuiPaths, TuiTerminalEnvironment, TuiStartup } from "./runtime"

export { LocalProvider, useLocal } from "./local"
export { createSimpleContext } from "./helper"

// ---------------------------------------------------------------------------
// Stubs for contexts that haven't been ported yet.
//
// Each stub provides:
//   - `<X>Provider` whose `value` is a frozen default value
//   - `useX()` that returns the default value
//
// Consumers that need richer behaviour should replace the relevant stub with a
// real port (drop in a new module, re-export from this file).
// ---------------------------------------------------------------------------

export { useDialog, useToast } from "./_reexports"

function makeStubProvider<T>(name: string, defaultValue: T) {
  const Ctx = React.createContext<T | undefined>(undefined)

  function Provider({ children, value }: { children?: ReactNode; value?: T }) {
    const resolved = React.useMemo(() => Object.freeze({ ...defaultValue, ...(value as Partial<T>) }) as T, [value])
    return React.createElement(Ctx.Provider, { value: resolved }, children)
  }

  function useStub(): T {
    const v = React.useContext(Ctx)
    if (v === undefined) {
      // Many stubs intentionally tolerate missing-provider because they're
      // wired in incrementally; returning the default keeps callers running.
      if (process.env.MAX_TUI_STRICT_CONTEXTS === "1") {
        throw new Error(`${name} context must be used within a ${name}Provider`)
      }
      return defaultValue
    }
    return v
  }

  return { Provider, use: useStub }
}

// --- Clipboard --------------------------------------------------------------

export type ClipboardValue = {
  write?: (text: string) => Promise<void>
}

const { Provider: ClipboardProvider, use: useClipboardImpl } = makeStubProvider<ClipboardValue>("Clipboard", {
  write: undefined,
})

export { ClipboardProvider, useClipboardImpl as useClipboard }

// --- Args -------------------------------------------------------------------

export type Args = {
  agent?: string
  model?: string
  sessionID?: string
  fork?: boolean
  continue?: boolean
  [key: string]: unknown
}

// Pre-export the resolved type so consumers can reference it without indexing
// into `TuiConfig["Resolved"]` everywhere.
export type TuiConfigResolved = {
  mouse: boolean
  keybinds: {
    gather: (group: string, commands: readonly string[]) => Array<{ key: string; desc: string; cmd: () => void }>
  }
  [key: string]: unknown
}

const { Provider: ArgsProvider, use: useArgs } = makeStubProvider<Args>("Args", {})
export { ArgsProvider, useArgs }

// --- KV ---------------------------------------------------------------------

export type KVValue = {
  get<T = unknown>(key: string, fallback?: T): T | undefined
  set(key: string, value: unknown): void
}

const kvImpl: KVValue = {
  get(_key, fallback) {
    return fallback
  },
  set() {
    /* no-op */
  },
}

const { Provider: KVProvider, use: useKV } = makeStubProvider<KVValue>("KV", kvImpl)
export { KVProvider, useKV }

// --- Route ------------------------------------------------------------------

export type Route =
  | { type: "home" }
  | { type: "session"; sessionID: string }
  | { type: "plugin"; id: string; data?: unknown }

export type RouteValue = {
  data: Route
  navigate: (next: Route) => void
}

const routeImpl: RouteValue = {
  data: { type: "home" },
  navigate() {
    /* no-op until RouteProvider is wired in */
  },
}

const { Provider: RouteProvider, use: useRoute } = makeStubProvider<RouteValue>("Route", routeImpl)
export { RouteProvider, useRoute }

// --- Exit -------------------------------------------------------------------

export type ExitValue = {
  exit: (reason?: unknown) => Promise<void> | void
}

function ExitContextRoot({ children, onExit }: { children?: ReactNode; onExit?: ExitValue["exit"] }) {
  const ctx = React.useMemo<ExitValue>(
    () => ({
      exit: onExit ?? ((reason?: unknown) => {
        if (reason !== undefined) console.error(reason)
        process.exit(0)
      }),
    }),
    [onExit],
  )
  return React.createElement(ExitContext.Provider, { value: ctx }, children)
}

const ExitContext = React.createContext<ExitValue | undefined>(undefined)

export function ExitProvider(props: { children?: ReactNode; exit?: ExitValue["exit"] }) {
  return <ExitContextRoot {...props} />
}

export function useExit(): ExitValue {
  const v = React.useContext(ExitContext)
  if (!v) {
    return {
      exit: (reason?: unknown) => {
        if (reason !== undefined) console.error(reason)
        process.exit(0)
      },
    }
  }
  return v
}

// --- PluginRuntime ----------------------------------------------------------

export type PluginRuntimeSlotProps = {
  name: string
}

export type PluginRuntimeValue = {
  routes: Map<string, React.ComponentType>
  Slot: React.ComponentType<PluginRuntimeSlotProps>
}

function DefaultSlot(_props: PluginRuntimeSlotProps) {
  return null
}

const pluginRuntimeImpl: PluginRuntimeValue = {
  routes: new Map(),
  Slot: DefaultSlot,
}

const { Provider: PluginRuntimeProvider, use: usePluginRuntime } = makeStubProvider<PluginRuntimeValue>(
  "PluginRuntime",
  pluginRuntimeImpl,
)
export { PluginRuntimeProvider, usePluginRuntime }

// --- Sync / Project / Event / Args / PromptRef / Editor ----------------
//
// Stubs only — these will be replaced as their ports land. The defaults are
// inert so call sites can run without crashing.

export type SyncValue = {
  status: "loading" | "partial" | "complete" | "error"
  data: Record<string, unknown>
}
const { Provider: SyncProvider, use: useSync } = makeStubProvider<SyncValue>("Sync", {
  status: "complete",
  data: {},
})
export { SyncProvider, useSync }

export type ProjectValue = {
  workspace: {
    current(): string | undefined
    get(id: string): { type?: string; directory?: string } | undefined
  }
}
const { Provider: ProjectProvider, use: useProject } = makeStubProvider<ProjectValue>("Project", {
  workspace: {
    current: () => undefined,
    get: () => undefined,
  },
})
export { ProjectProvider, useProject }

export type EventValue = {
  on(type: string, handler: (event: unknown) => void): () => void
  off(type: string, handler: (event: unknown) => void): void
}
const { Provider: EventProvider, use: useEvent } = makeStubProvider<EventValue>("Event", {
  on() {
    return () => {}
  },
  off() {
    /* no-op */
  },
})
export { EventProvider, useEvent }

export type TuiConfig = {
  Resolved: TuiConfigResolved
}

// Default-arg shim so consumers can use a real TuiConfig value type.
export const TUI_CONFIG_DEFAULT: TuiConfigResolved = {
  mouse: true,
  keybinds: {
    gather() {
      return []
    },
  },
}

export type PluginHost = {
  start(input: { api: unknown; config: TuiConfigResolved; runtime: PluginRuntimeValue; dispose: () => void }): Promise<void>
  dispose(): Promise<void>
}

// PromptRef / Editor are placeholders; consumers should cast as needed.
const { Provider: PromptRefProvider, use: usePromptRef } = makeStubProvider<{
  current: { focused?: boolean; current?: { input?: string } } | null
}>("PromptRef", { current: null })
export { PromptRefProvider, usePromptRef }

const { Provider: EditorContextProvider, use: useEditor } = makeStubProvider<Record<string, unknown>>(
  "Editor",
  {},
)
export { EditorContextProvider, useEditor }

// OpencodeKeymap is referenced by app.tsx for keybindings; stub it.
const { Provider: OpencodeKeymapProvider, use: useOpencodeKeymap } = makeStubProvider<{
  intercept: (...args: unknown[]) => () => void
  dispatchCommand: (command: string) => void
}>("OpencodeKeymap", {
  intercept: () => () => {},
  dispatchCommand: () => {},
})
export { OpencodeKeymapProvider, useOpencodeKeymap }

export function useBindings(_input: unknown): void {
  /* bindings are wired through OpencodeKeymap; stub kept for compat */
}

export const OPENCODE_BASE_MODE = "base"