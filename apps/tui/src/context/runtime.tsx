/**
 * TUI runtime context: paths, terminal environment, and startup flags.
 *
 * Ported from OpenCode's SolidJS `runtime.tsx`. Solid used individual context
 * providers via `createContext`; React 19 lets us co-locate these three small
 * providers into a single shape with three `useXxx()` hooks for symmetry.
 */

import { createContext, createElement, useContext, type ReactNode } from "react"

export type TuiPaths = Readonly<{
  cwd: string
  home: string
  state: string
  worktree: string
}>

export type TuiTerminalEnvironment = Readonly<{
  platform: string
  multiplexer?: "tmux" | "screen"
  displayServer?: "wayland" | "x11"
}>

export type TuiStartup = Readonly<{
  initialRoute?: unknown
  skipInitialLoading: boolean
}>

type RuntimeValue = {
  paths: TuiPaths
  env: TuiTerminalEnvironment
  startup: TuiStartup
}

const RuntimeContext = createContext<RuntimeValue | undefined>(undefined)

export function TuiRuntimeProvider(props: {
  value: { paths: TuiPaths; env: TuiTerminalEnvironment; startup: TuiStartup }
  children: ReactNode
}) {
  const value = Object.freeze({ ...props.value })
  return createElement(RuntimeContext.Provider, { value }, props.children)
}

function require<T>(name: string, ctx: React.Context<T | undefined>): T {
  const value = useContext(ctx)
  if (!value) throw new Error(`${name} is missing`)
  return value
}

export function useTuiPaths(): TuiPaths {
  return require("TuiPathsProvider", RuntimeContext).paths
}

export function useTuiTerminalEnvironment(): TuiTerminalEnvironment {
  return require("TuiTerminalEnvironmentProvider", RuntimeContext).env
}

export function useTuiStartup(): TuiStartup {
  return require("TuiStartupProvider", RuntimeContext).startup
}