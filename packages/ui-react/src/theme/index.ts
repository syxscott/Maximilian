export type ThemeName = "light" | "dark"

export interface ThemeColors {
  background: string
  backgroundStronger: string
  surface: string
  border: string
  text: string
  textStrong: string
  textMuted: string
  primary: string
  primaryForeground: string
  accent: string
  success: string
  warning: string
  danger: string
  info: string
}

export interface ThemeSyntax {
  comment: string
  keyword: string
  string: string
  number: string
  regexp: string
  variable: string
  constant: string
  property: string
  punctuation: string
  operator: string
  type: string
  function: string
  primitive: string
  object: string
  critical: string
  info: string
  warning: string
  unknown: string
  diffAdd: string
  diffDelete: string
}

export interface Theme {
  name: ThemeName
  colors: ThemeColors
  syntax: ThemeSyntax
  /**
   * A flat map of CSS custom property names to values. Apply these to a root
   * element (e.g. `document.documentElement`) to drive CSS variables.
   */
  cssVars: Record<string, string>
}

export { darkTheme } from "./dark.js"
export { lightTheme } from "./light.js"
export { useTheme, ThemeProvider, type ThemeMode } from "../context/theme.js"