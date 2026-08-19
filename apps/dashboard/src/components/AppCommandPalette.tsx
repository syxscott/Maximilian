/**
 * AppCommandPalette — Cmd+K 全局命令面板。
 *
 * 借鉴 cmdk / Raycast / Linear：键盘可达、跨 tab 跳转、设置项快速访问。
 */

import { useMemo } from "react"
import { CommandPalette, type CommandGroup } from "@max/ui-react"
import { useLocale, t } from "@max/i18n"

export interface AppCommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onNavigate: (tab: "workspace" | "executions" | "governance" | "evolution" | "providers" | "usage" | "settings") => void
  onToggleTheme: () => void
  onOpenUsage: () => void
}

export function AppCommandPalette(props: AppCommandPaletteProps) {
  const locale = useLocale().locale
  void locale

  const groups: CommandGroup[] = useMemo(
    () => [
      {
        id: "navigation",
        heading: "Navigation",
        items: [
          { id: "nav.workspace", label: t("nav.workspace"), onSelect: () => props.onNavigate("workspace"), shortcut: "G W" },
          { id: "nav.executions", label: t("nav.executions"), onSelect: () => props.onNavigate("executions"), shortcut: "G E" },
          { id: "nav.governance", label: t("nav.governance"), onSelect: () => props.onNavigate("governance"), shortcut: "G G" },
          { id: "nav.evolution", label: t("nav.evolution"), onSelect: () => props.onNavigate("evolution"), shortcut: "G V" },
          { id: "nav.usage", label: t("nav.usage"), onSelect: () => { props.onNavigate("usage"); props.onOpenUsage() }, shortcut: "G U" },
          { id: "nav.providers", label: t("nav.providers"), onSelect: () => props.onNavigate("providers"), shortcut: "G P" },
          { id: "nav.settings", label: t("nav.settings"), onSelect: () => props.onNavigate("settings"), shortcut: "G S" },
        ],
      },
      {
        id: "actions",
        heading: "Actions",
        items: [
          // Shortcut hints here describe the key that performs the action
          // once the palette is open — Esc is bound by CommandPalette's
          // own keyboard handler, the toggle-theme hint was misleading
          // (no "T" key inside the palette actually runs it).
          { id: "act.toggleTheme", label: "Toggle theme", onSelect: () => { props.onToggleTheme(); props.onOpenChange(false) } },
          { id: "act.closePalette", label: "Close palette", onSelect: () => props.onOpenChange(false), shortcut: "Esc" },
        ],
      },
    ],
    // Spread the callbacks out so the memo only re-fires when one of them
    // actually changes. With `[props]` (a fresh object every render) the
    // memo ran every parent render — fine perf-wise today, but it makes
    // the CommandPalette think the palette is "new" on every keystroke
    // when the user is typing into a focused element upstream.
    [props.onNavigate, props.onOpenChange, props.onToggleTheme, props.onOpenUsage],
  )

  return (
    <CommandPalette
      open={props.open}
      onOpenChange={props.onOpenChange}
      groups={groups}
      placeholder="Type a command or search..."
      enableGlobalShortcut={false}
    />
  )
}