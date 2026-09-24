/**
 * AppCommandPalette — Cmd+K 全局命令面板。
 *
 * 借鉴 cmdk / Raycast / Linear：键盘可达、跨 tab 跳转、设置项快速访问。
 * 查询历史接入 searchStore：执行一条命令会把它的标签 commit 进 recent
 * （持久化、去重、上限 10 条），并在面板顶部渲染 "Recent" 分组供回放。
 */

import { useCallback, useMemo } from "react"
import { CommandPalette, type CommandGroup } from "@max/ui-react"
import { useLocale, t } from "@max/i18n"
import { useSearchStore, useRecentSearches } from "@/stores/searchStore"

export interface AppCommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onNavigate: (
    tab:
      "workspace" | "executions" | "governance" | "evolution" | "providers" | "usage" | "settings",
  ) => void
  onToggleTheme: () => void
  onOpenUsage: () => void
}

export function AppCommandPalette(props: AppCommandPaletteProps) {
  // Subscribes the component to locale changes so translated labels
  // re-resolve; the value itself feeds the memo deps below.
  const locale = useLocale().locale

  // Commit an executed command's label into the persisted recent list
  // (searchStore: front-insert, dedupe, cap at 10, localStorage-backed).
  const recordCommand = useCallback((label: string) => {
    const search = useSearchStore.getState()
    search.setQuery(label)
    search.commitSearch()
  }, [])

  const recent = useRecentSearches()

  const groups: CommandGroup[] = useMemo(
    () => [
      ...(recent.length > 0
        ? [
            {
              id: "recent",
              heading: t("palette.heading.recent"),
              items: recent.map((label) => ({
                id: `recent.${label}`,
                label,
                onSelect: () => recordCommand(label),
              })),
            },
          ]
        : []),
      {
        id: "navigation",
        heading: t("palette.heading.navigation"),
        items: [
          {
            id: "nav.workspace",
            label: t("nav.workspace"),
            description: t("nav.workspace.description"),
            onSelect: () => {
              recordCommand(t("nav.workspace"))
              props.onNavigate("workspace")
            },
            shortcut: "G W",
          },
          {
            id: "nav.executions",
            label: t("nav.executions"),
            description: t("nav.executions.description"),
            onSelect: () => {
              recordCommand(t("nav.executions"))
              props.onNavigate("executions")
            },
            shortcut: "G E",
          },
          {
            id: "nav.governance",
            label: t("nav.governance"),
            description: t("nav.governance.description"),
            onSelect: () => {
              recordCommand(t("nav.governance"))
              props.onNavigate("governance")
            },
            shortcut: "G G",
          },
          {
            id: "nav.evolution",
            label: t("nav.evolution"),
            description: t("nav.evolution.description"),
            onSelect: () => {
              recordCommand(t("nav.evolution"))
              props.onNavigate("evolution")
            },
            shortcut: "G V",
          },
          {
            id: "nav.usage",
            label: t("nav.usage"),
            description: t("nav.usage.description"),
            onSelect: () => {
              recordCommand(t("nav.usage"))
              props.onNavigate("usage")
              props.onOpenUsage()
            },
            shortcut: "G U",
          },
          {
            id: "nav.providers",
            label: t("nav.providers"),
            description: t("nav.providers.description"),
            onSelect: () => {
              recordCommand(t("nav.providers"))
              props.onNavigate("providers")
            },
            shortcut: "G P",
          },
          {
            id: "nav.settings",
            label: t("nav.settings"),
            description: t("nav.settings.description"),
            onSelect: () => {
              recordCommand(t("nav.settings"))
              props.onNavigate("settings")
            },
            shortcut: "G S",
          },
        ],
      },
      {
        id: "actions",
        heading: t("palette.heading.actions"),
        items: [
          // Shortcut hints here describe the key that performs the action
          // once the palette is open — Esc is bound by CommandPalette's
          // own keyboard handler, the toggle-theme hint was misleading
          // (no "T" key inside the palette actually runs it).
          {
            id: "act.toggleTheme",
            label: t("palette.action.toggleTheme"),
            onSelect: () => {
              recordCommand(t("palette.action.toggleTheme"))
              props.onToggleTheme()
              props.onOpenChange(false)
            },
          },
          {
            id: "act.closePalette",
            label: t("palette.action.closePalette"),
            onSelect: () => props.onOpenChange(false),
            shortcut: "Esc",
          },
        ],
      },
    ],
    // Recent history, the active locale, and the recording callback
    // participate in the deps so the "Recent" group tracks the store and
    // translated labels re-resolve when the locale changes.
    [
      props.onNavigate,
      props.onOpenChange,
      props.onToggleTheme,
      props.onOpenUsage,
      locale,
      recent,
      recordCommand,
    ],
  )

  return (
    <CommandPalette
      open={props.open}
      onOpenChange={props.onOpenChange}
      groups={groups}
      placeholder={t("palette.placeholder")}
      enableGlobalShortcut={false}
    />
  )
}
