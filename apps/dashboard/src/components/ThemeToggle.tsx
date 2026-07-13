/**
 * Theme toggle — three-state (system / light / dark) pill button.
 *
 * Cycles through modes on click. Each option has a distinct lucide icon so
 * the current state is visible without opening the Settings tab.
 */

import { Monitor, Moon, Sun } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useTheme, type ThemeMode } from "@/lib/theme"
import { useLocale, t } from "@max/i18n"

const ORDER: ThemeMode[] = ["system", "light", "dark"]

const ICONS = {
  system: Monitor,
  light: Sun,
  dark: Moon,
} as const

const LABEL_KEYS: Record<ThemeMode, string> = {
  system: "theme.followSystem",
  light: "theme.light",
  dark: "theme.dark",
}

export function ThemeToggle() {
  useLocale()
  const { mode, setMode } = useTheme()
  const Icon = ICONS[mode]
  const next = ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length]!
  const currentLabel = t(LABEL_KEYS[mode])
  const nextLabel = t(LABEL_KEYS[next])

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setMode(next)}
      title={t("theme.toggleTitle", { current: currentLabel, next: nextLabel })}
      aria-label={t("theme.toggleAria", { mode: currentLabel })}
      data-testid="theme-toggle"
    >
      <Icon className="h-4 w-4" />
    </Button>
  )
}
