import * as React from "react"
import { darkTheme } from "../theme/dark"
import { lightTheme } from "../theme/light"
import type { Theme, ThemeName } from "../theme"

export type ThemeMode = "light" | "dark" | "system"

export interface ThemeContextValue {
  /** The resolved theme currently applied. */
  theme: Theme
  /** The active theme name (without `system` resolution). */
  name: ThemeName
  /** The user-selected mode. */
  mode: ThemeMode
  /** Set the user's theme preference. */
  setMode: (mode: ThemeMode) => void
  /** Toggle between light and dark (preserves system if currently system). */
  toggle: () => void
}

const ThemeContext = React.createContext<ThemeContextValue | undefined>(undefined)

function getSystemTheme(): ThemeName {
  if (typeof window === "undefined") return "dark"
  if (typeof window.matchMedia !== "function") return "dark"
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

function resolveTheme(mode: ThemeMode): { name: ThemeName; theme: Theme } {
  if (mode === "system") {
    const name = getSystemTheme()
    return { name, theme: name === "dark" ? darkTheme : lightTheme }
  }
  if (mode === "dark") return { name: "dark", theme: darkTheme }
  return { name: "light", theme: lightTheme }
}

const STORAGE_KEY = "maximilian.theme.mode"

export interface ThemeProviderProps {
  /** Default mode if none is persisted. */
  defaultMode?: ThemeMode
  /** Children to be themed. */
  children?: React.ReactNode
}

export function ThemeProvider(props: ThemeProviderProps) {
  const [mode, setModeState] = React.useState<ThemeMode>(() => {
    if (typeof window !== "undefined") {
      try {
        const stored = window.localStorage.getItem(STORAGE_KEY) as ThemeMode | null
        if (stored === "light" || stored === "dark" || stored === "system") {
          return stored
        }
      } catch {
        // ignore
      }
    }
    return props.defaultMode ?? "system"
  })

  const [resolved, setResolved] = React.useState(() => resolveTheme(mode))

  // Resolve theme whenever mode changes (and on system change when mode === "system").
  React.useEffect(() => {
    setResolved(resolveTheme(mode))

    if (mode !== "system") return
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return
    const mql = window.matchMedia("(prefers-color-scheme: dark)")
    const handler = () => setResolved(resolveTheme("system"))
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", handler)
      return () => mql.removeEventListener("change", handler)
    }
    mql.addListener(handler)
    return () => mql.removeListener(handler)
  }, [mode])

  // Apply the theme by toggling a class on `<html>` and updating CSS variables.
  React.useEffect(() => {
    if (typeof document === "undefined") return
    const root = document.documentElement
    root.dataset.theme = resolved.name
    root.classList.toggle("dark", resolved.name === "dark")
    root.classList.toggle("light", resolved.name === "light")

    const style = root.style
    for (const [key, value] of Object.entries(resolved.theme.cssVars)) {
      style.setProperty(key, value)
    }
  }, [resolved])

  const setMode = React.useCallback((next: ThemeMode) => {
    setModeState(next)
    try {
      if (typeof window !== "undefined") {
        window.localStorage.setItem(STORAGE_KEY, next)
      }
    } catch {
      // ignore
    }
  }, [])

  const toggle = React.useCallback(() => {
    setMode(resolved.name === "dark" ? "light" : "dark")
  }, [resolved.name, setMode])

  const value = React.useMemo<ThemeContextValue>(
    () => ({
      theme: resolved.theme,
      name: resolved.name,
      mode,
      setMode,
      toggle,
    }),
    [resolved, mode, setMode, toggle],
  )

  return <ThemeContext.Provider value={value}>{props.children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = React.useContext(ThemeContext)
  if (!ctx) {
    throw new Error("useTheme must be used within a ThemeProvider")
  }
  return ctx
}