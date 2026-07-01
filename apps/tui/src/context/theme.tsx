/**
 * Theme context for the Maximilian TUI.
 *
 * Ported from OpenCode's SolidJS `theme.tsx`. The original used
 * `@opentui/core` SyntaxStyle / RGBA primitives, plus `useRenderer` from
 * `@opentui/solid` for terminal palette detection.
 *
 * Maximilian's TUI is built on ink (React 19), which doesn't expose a custom
 * terminal renderer. We therefore model themes as plain string-keyed color
 * objects compatible with chalk-style consumers and `ink`'s `color` prop.
 * System palette detection and `CLI_RENDER_EVENTS` are stubbed behind a
 * no-op subscription so callers don't need to change.
 */

import { createContext, createElement, useContext, useMemo, type ReactNode } from "react"
import { createSimpleContext } from "./helper"

export type ThemeColors = Readonly<{
  background: string
  backgroundPanel: string
  backgroundElement: string
  backgroundMenu: string
  border: string
  borderActive: string
  text: string
  textMuted: string
  primary: string
  secondary: string
  accent: string
  success: string
  warning: string
  error: string
  info: string
  diffAdded: string
  diffRemoved: string
  diffAddedBg: string
  diffRemovedBg: string
  diffContextBg: string
  diffHighlightAdded: string
  diffHighlightRemoved: string
  diffLineNumber: string
  diffAddedLineNumberBg: string
  diffRemovedLineNumberBg: string
  markdownText: string
}>

export type ThemeJson = {
  name: string
  mode: "dark" | "light"
  colors: Record<string, string>
}

export type ThemeSource = Readonly<{
  discover(): Promise<Record<string, unknown>>
  subscribeRefresh?(refresh: () => void): () => void
}>

const darkDefault: ThemeColors = {
  background: "#0e0e10",
  backgroundPanel: "#18181b",
  backgroundElement: "#27272a",
  backgroundMenu: "#1f1f23",
  border: "#3f3f46",
  borderActive: "#52525b",
  text: "#fafafa",
  textMuted: "#a1a1aa",
  primary: "#60a5fa",
  secondary: "#a78bfa",
  accent: "#34d399",
  success: "#22c55e",
  warning: "#facc15",
  error: "#f87171",
  info: "#38bdf8",
  diffAdded: "#22c55e",
  diffRemoved: "#ef4444",
  diffAddedBg: "#052e16",
  diffRemovedBg: "#3f0d12",
  diffContextBg: "#18181b",
  diffHighlightAdded: "#86efac",
  diffHighlightRemoved: "#fca5a5",
  diffLineNumber: "#71717a",
  diffAddedLineNumberBg: "#14532d",
  diffRemovedLineNumberBg: "#7f1d1d",
  markdownText: "#e4e4e7",
}

export const DEFAULT_THEMES: Record<string, ThemeJson> = {
  opencode: { name: "opencode", mode: "dark", colors: darkDefault as unknown as Record<string, string> },
}

export const allThemes = (): Record<string, ThemeJson> => ({ ...DEFAULT_THEMES })

export function hasTheme(name: string): boolean {
  return name in DEFAULT_THEMES
}

export function isTheme(value: unknown): value is ThemeJson {
  return !!value && typeof value === "object" && "name" in (value as object) && "colors" in (value as object)
}

export function resolveTheme(json: ThemeJson, _mode: "dark" | "light"): ThemeColors {
  return { ...darkDefault, ...(json.colors as unknown as Partial<ThemeColors>) }
}

export function generateSystem(_colors: unknown, mode: "dark" | "light"): ThemeJson {
  return { name: "system", mode, colors: darkDefault as unknown as Record<string, string> }
}

export function generateSyntax(_theme: ThemeColors): unknown {
  // ink has no native syntax highlighting; consumers should layer in
  // something like `cli-highlight` if they need it.
  return null
}

export function generateSubtleSyntax(theme: ThemeColors): unknown {
  return generateSyntax(theme)
}

export function selectedForeground(_theme: ThemeColors, background?: string): string {
  return background ?? "#ffffff"
}

export function setCustomThemes(_themes: Record<string, ThemeJson>): void {
  /* no-op: ink-based TUI keeps themes in-memory only */
}

export function setSystemTheme(_theme: ThemeJson | undefined): void {
  /* no-op */
}

export function subscribeThemes(_listener: (themes: Record<string, ThemeJson>) => void): () => void {
  return () => {}
}

export function terminalMode(_colors: unknown): "dark" | "light" | undefined {
  return undefined
}

export type ThemeContextValue = {
  theme: ThemeColors
  selected: string
  all: () => Record<string, ThemeJson>
  has: (name: string) => boolean
  syntax: unknown
  subtleSyntax: unknown
  mode: () => "dark" | "light"
  locked: () => boolean
  lock: () => void
  unlock: () => void
  setMode: (mode: "dark" | "light") => void
  set: (name: string) => boolean
  ready: boolean
}

export const { use: useTheme, provider: ThemeProvider } = createSimpleContext<ThemeContextValue, { mode: "dark" | "light" }>({
  name: "Theme",
  init: (props) => {
    const initial = DEFAULT_THEMES.opencode
    const theme = useMemo(() => resolveTheme(initial, props.mode), [props.mode])

    return {
      theme,
      selected: initial.name,
      all: allThemes,
      has: hasTheme,
      syntax: generateSyntax(theme),
      subtleSyntax: generateSubtleSyntax(theme),
      mode: () => props.mode,
      locked: () => false,
      lock: () => {},
      unlock: () => {},
      setMode: () => {},
      set: (name: string) => hasTheme(name),
      ready: true,
    }
  },
})

/**
 * Re-export so consumers can avoid importing `@opentui/core`. Returns a
 * `null`-shaped stand-in that is safe to spread into ink props.
 */
export function createSyntaxStyleMemo(factory: () => unknown): () => unknown {
  return () => factory()
}

// Standalone helper retained so consumers that expect a JSX component can use
// `<ThemeContext.Provider value={...}>` directly if they bypass `ThemeProvider`.
export const ThemeContext: React.Context<ThemeContextValue | undefined> = createContext<ThemeContextValue | undefined>(
  undefined,
)

export function ThemeInlineProvider(props: { value: ThemeContextValue; children: ReactNode }) {
  return createElement(ThemeContext.Provider, { value: props.value }, props.children)
}