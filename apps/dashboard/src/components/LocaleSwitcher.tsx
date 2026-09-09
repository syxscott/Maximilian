/**
 * LocaleSwitcher — Header 顶部快速切换中英文。
 *
 * 借鉴 pi / Raycast / Cursor：在 header 右上角放一个紧凑的语言切换按钮，
 * 当前语言高亮，点击切换到下一个 locale。轻量、不打断布局。
 */

import { useLocale, listLocales, localeDisplayName } from "@max/i18n"
import { Button } from "@/components/ui/button"
import { Languages } from "lucide-react"

export function LocaleSwitcher() {
  const { locale, setLocale } = useLocale()
  const locales = listLocales()
  // Only two locales are registered today (en-US, zh-CN); show a real toggle
  // when there are 2. With more, fall back to a cycle that walks through
  // them in deterministic order.
  if (locales.length === 0) return null

  function nextLocale() {
    if (locales.length < 2) return
    const idx = locales.indexOf(locale)
    // Defensive: if the current locale isn't in the list (shouldn't happen
    // because useLocale coerces unknown to default), fall back to the first
    // entry rather than index-out-of-bounds.
    const next = idx === -1 ? 0 : (idx + 1) % locales.length
    setLocale(locales[next]!)
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={nextLocale}
      // The label is short on purpose (header has limited horizontal space);
      // tooltip-bearing full name is conveyed via the title attribute.
      title={`Switch language (current: ${localeDisplayName(locale)})`}
      aria-label={`Switch language, current ${localeDisplayName(locale)}`}
      data-testid="locale-switcher"
      className="gap-1.5"
    >
      <Languages className="h-3.5 w-3.5" />
      <span className="text-xs font-mono">{locale.toUpperCase()}</span>
    </Button>
  )
}
