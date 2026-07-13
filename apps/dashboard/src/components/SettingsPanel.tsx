/**
 * Settings panel — user-facing preferences for theme, performance tier,
 * language, and tool permissions. Theme and tier persist via lib/theme
 * and lib/perf-tier; locale persists via @max/i18n; permissions
 * read/write via the API.
 */

import { useTheme, type ThemeMode } from "@/lib/theme"
import { usePerfTier, type PerfTier, type PerfTierMode } from "@/lib/perf-tier"
import { listLocales, localeDisplayName, useLocale } from "@max/i18n"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Monitor, Moon, Sun, Cpu, Zap, Gauge, Languages } from "lucide-react"
import { PermissionsMatrix } from "./PermissionsMatrix"
import { t } from "@max/i18n"

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
