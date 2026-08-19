/**
 * Settings panel — user-facing preferences for theme, performance tier,
 * language, and tool permissions. Theme and tier persist via lib/theme
 * and lib/perf-tier; locale persists via @max/i18n; permissions
 * read/write via the API.
 */

import { useEffect, useState } from "react"
import { useTheme, type ThemeMode } from "@/lib/theme"
import { usePerfTier, type PerfTier, type PerfTierMode } from "@/lib/perf-tier"
import { listLocales, localeDisplayName, useLocale } from "@max/i18n"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ColorPicker } from "@max/ui-react"
import { Monitor, Moon, Sun, Cpu, Zap, Gauge, Languages, Palette } from "lucide-react"
import { PermissionsMatrix } from "./PermissionsMatrix"
import { t } from "@max/i18n"

// ── Accent color ────────────────────────────────────────────────────────────
//
// We let the user override the dashboard's accent color. The default follows
// the active theme — overridden by a user choice one level up in the CSS
// cascade. Reads/writes MX_ACCENT_STORAGE_KEY so the choice survives reloads.
const MX_ACCENT_STORAGE_KEY = "mx-accent"
const DEFAULT_ACCENT = "#6366f1" // indigo-500 — matches the project palette defaults

function readAccent(): string {
  if (typeof window === "undefined") return DEFAULT_ACCENT
  try {
    const v = window.localStorage.getItem(MX_ACCENT_STORAGE_KEY)
    return v && /^#[0-9a-fA-F]{6}$/.test(v) ? v : DEFAULT_ACCENT
  } catch {
    return DEFAULT_ACCENT
  }
}

function writeAccent(value: string): void {
  if (typeof document === "undefined") return
  // The picker drives two CSS custom properties at the root so the override
  // actually reaches the UI:
  //   - `--shadcn-primary` — used by `Button` and other shadcn primitives
  //     via Tailwind v4's `@theme` bridge in index.css. Overriding it here
  //     flips the accent of every primary button without recompiling CSS.
  //   - `--shadcn-ring` — focus ring color (otherwise the focus indicator
  //     would stay the previous primary).
  // Earlier we also wrote a precomputed `color-mix(...)` into
  // `--mx-accent-soft`, but `color-mix()` isn't valid as a static value of
  // a custom property without `@property` registration — older browsers
  // would render the string literally and ignore it. Callers that need a
  // soft variant should write their own `color-mix()` in their stylesheet.
  const root = document.documentElement
  root.style.setProperty("--shadcn-primary", value)
  root.style.setProperty("--shadcn-ring", value)
  // We still expose `--mx-accent` for downstream components that want to
  // read the user's chosen accent directly (charts, badges, etc.).
  root.style.setProperty("--mx-accent", value)
  try {
    window.localStorage.setItem(MX_ACCENT_STORAGE_KEY, value)
  } catch {
    // localStorage may be unavailable (private mode, quota); in-memory
    // override still applies for the current session.
  }
}

function restoreAccent(): void {
  writeAccent(readAccent())
}

const THEME_OPTIONS: Array<{ mode: ThemeMode; icon: typeof Monitor }> = [
  { mode: "system", icon: Monitor },
  { mode: "light", icon: Sun },
  { mode: "dark", icon: Moon },
]

const TIER_OPTIONS: Array<{ mode: PerfTierMode; icon: typeof Cpu; key: string }> = [
  {
    mode: "auto",
    icon: Gauge,
    key: "settings.performance.auto",
  },
  {
    mode: "low",
    icon: Cpu,
    key: "settings.performance.low",
  },
  {
    mode: "high",
    icon: Zap,
    key: "settings.performance.high",
  },
]

const TIER_DESCRIPTIONS: Record<PerfTierMode, string> = {
  auto: "settings.performance.autoDesc",
  low: "settings.performance.lowDesc",
  high: "settings.performance.highDesc",
}

export function SettingsPanel() {
  const { mode: themeMode, setMode: setThemeMode } = useTheme()
  const { mode: tierMode, effective, setMode: setTierMode } = usePerfTier()
  const { locale, setLocale, reset } = useLocale()

  // Re-apply the saved accent on mount in case another panel cleared the
  // inline style. We treat storage as the source of truth.
  const [accent, setAccent] = useState<string>(() => readAccent())
  useEffect(() => {
    restoreAccent()
  }, [])
  const handleAccentChange = (next: string) => {
    setAccent(next)
    writeAccent(next)
  }
  const handleAccentReset = () => {
    setAccent(DEFAULT_ACCENT)
    writeAccent(DEFAULT_ACCENT)
  }

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-6">
      <h2 className="text-lg font-semibold text-foreground">{t("settings.title")}</h2>

      {/* Theme */}
      <Card className="bg-muted/30">
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-base text-foreground">
            {t("settings.appearance.title")}
          </CardTitle>
        </CardHeader>
        <CardContent className="py-3 px-4 space-y-3">
          <p className="text-sm text-muted-foreground">{t("settings.appearance.description")}</p>
          <div className="flex gap-2">
            {THEME_OPTIONS.map((opt) => {
              const Icon = opt.icon
              const selected = themeMode === opt.mode
              return (
                <Button
                  key={opt.mode}
                  variant={selected ? "default" : "secondary"}
                  onClick={() => setThemeMode(opt.mode)}
                  data-testid={`theme-option-${opt.mode}`}
                >
                  <Icon className="h-4 w-4 mr-2" />
                  {t(`settings.appearance.${opt.mode}`)}
                </Button>
              )
            })}
          </div>
          <div className="pt-2 border-t border-border/60 space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Palette className="h-4 w-4" />
              Accent color
            </div>
            <p className="text-xs text-muted-foreground">
              Override the dashboard accent. Applies to buttons, links, and
              focus rings across the app.
            </p>
            <div className="flex flex-wrap items-start gap-3">
              <ColorPicker
                value={accent}
                onChange={handleAccentChange}
                showInput
                showAlpha={false}
                data-testid="accent-picker"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={handleAccentReset}
                data-testid="accent-reset"
              >
                Reset
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Performance */}
      <Card className="bg-muted/30">
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-base text-foreground">
            {t("settings.performance.title")}
          </CardTitle>
        </CardHeader>
        <CardContent className="py-3 px-4 space-y-3">
          <p className="text-sm text-muted-foreground">{t("settings.performance.description")}</p>
          <div className="flex gap-2 flex-wrap">
            {TIER_OPTIONS.map((opt) => {
              const Icon = opt.icon
              const selected = tierMode === opt.mode
              return (
                <Button
                  key={opt.mode}
                  variant={selected ? "default" : "secondary"}
                  onClick={() => setTierMode(opt.mode)}
                  data-testid={`perf-option-${opt.mode}`}
                >
                  <Icon className="h-4 w-4 mr-2" />
                  {t(opt.key)}
                </Button>
              )
            })}
          </div>
          <p className="text-xs text-muted-foreground" data-testid="perf-effective">
            Effective tier: <strong>{effective}</strong>
            {tierMode === "auto" && effective !== "high" && (
              <span> · detected as {effective} on this device</span>
            )}
          </p>
        </CardContent>
      </Card>

      {/* Language */}
      <Card className="bg-muted/30">
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-base text-foreground flex items-center gap-2">
            <Languages className="h-4 w-4" />
            {t("settings.language.title")}
          </CardTitle>
        </CardHeader>
        <CardContent className="py-3 px-4 space-y-3">
          <p className="text-sm text-muted-foreground">{t("settings.language.description")}</p>
          <div className="flex gap-2 flex-wrap items-center">
            {listLocales().map((l) => {
              const selected = locale === l
              return (
                <Button
                  key={l}
                  variant={selected ? "default" : "secondary"}
                  onClick={() => setLocale(l)}
                  data-testid={`locale-option-${l}`}
                >
                  {localeDisplayName(l)}
                </Button>
              )
            })}
            <Button variant="outline" onClick={reset} data-testid="locale-reset">
              {t("settings.language.followSystem")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Permissions */}
      <PermissionsMatrix />
    </div>
  )
}

export type { PerfTier, PerfTierMode }
