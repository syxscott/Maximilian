// @ts-nocheck
import React, { useMemo, useState, useEffect } from "react"
import { Box, Text } from "ink"
import { useBindings, useKeymapSelector } from "../../keymap"
import type { ActiveKey } from "@opentui/keymap"
import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"

const command = {
  toggle: "which-key.toggle",
  toggleLayout: "which-key.layout.toggle",
  togglePending: "which-key.pending.toggle",
  groupPrevious: "which-key.group.previous",
  groupNext: "which-key.group.next",
  scrollUp: "which-key.scroll.up",
  scrollDown: "which-key.scroll.down",
  pageUp: "which-key.page.up",
  pageDown: "which-key.page.down",
  home: "which-key.home",
  end: "which-key.end",
} as const

const LAYER_PRIORITY = 900
const KV_LAYOUT = "which_key_layout"
const KV_PENDING_PREVIEW = "which_key_pending_preview"
const toggleCommands = [command.toggle, command.toggleLayout, command.togglePending] as const
const scrollCommands = [
  command.scrollUp,
  command.scrollDown,
  command.pageUp,
  command.pageDown,
  command.home,
  command.end,
] as const
const panelCommands = [command.groupPrevious, command.groupNext, ...scrollCommands] as const
const COLUMN_GAP = 4
const TAB_GAP = 3
const MIN_TAB_GAP = 1
const TAB_CONTENT_GAP = 1
const MIN_COLUMN_WIDTH = 28
const MAX_COLUMN_WIDTH = 44
const PANEL_HEIGHT_RATIO = 0.3
const MIN_PANEL_HEIGHT = 8
const MAX_PANEL_HEIGHT = 16
const PANEL_TOP_PADDING = 1
const FOOTER_HEIGHT = 1
const FOOTER_MARGIN = 1
const UNKNOWN = "Unknown"

type Layout = "dock" | "overlay"

type Skin = {
  panel: string
  text: string
  muted: string
  subtle: string
  key: string
  accent: string
  tab: string
  tabText: string
}

type Entry = {
  type: "entry"
  key: string
  label: string
  group: string
  continues: boolean
}

type Group = {
  label: string
  entries: Entry[]
}

type HeaderItem = { type: "tab"; group: Group } | { type: "scroll" }

type GroupHeader = {
  type: "group"
  label: string
}

type Item = Entry | GroupHeader

function text(value: unknown) {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

function ink(api: TuiPluginApi, name: string, fallback: string): string {
  const value = Reflect.get(api.theme.current, name)
  if (typeof value === "string") return value
  return fallback
}

function skin(api: TuiPluginApi): Skin {
  return {
    panel: ink(api, "backgroundMenu", "#1c1c1c"),
    text: ink(api, "text", "#f0f0f0"),
    muted: ink(api, "textMuted", "#a5a5a5"),
    subtle: ink(api, "borderSubtle", "#6f6f6f"),
    key: ink(api, "warning", "#ffd75f"),
    accent: ink(api, "primary", "#5f87ff"),
    tab: ink(api, "primary", "#5f87ff"),
    tabText: ink(api, "selectedListItemText", "#ffffff"),
  }
}

function activeKeyLabel(active: ActiveKey) {
  if (active.continues) return text(active.tokenName) ?? text(active.display) ?? UNKNOWN
  return (
    text(active.commandAttrs?.title) ?? text(active.bindingAttrs?.desc) ?? text(active.commandAttrs?.desc) ?? UNKNOWN
  )
}

function activeKeyGroup(active: ActiveKey) {
  if (active.continues) return "System"
  return text(active.commandAttrs?.category) ?? text(active.bindingAttrs?.group) ?? UNKNOWN
}

function activeKeyEntry(api: TuiPluginApi, active: ActiveKey): Entry {
  const key = api.keys.formatSequence([
    {
      stroke: active.stroke,
      display: active.display,
      tokenName: active.tokenName,
    },
  ])
  const label = activeKeyLabel(active)
  return {
    type: "entry",
    key,
    label: active.continues ? `+${label}` : label,
    group: activeKeyGroup(active),
    continues: active.continues,
  }
}

function grouped(entries: Entry[]): Group[] {
  const map = new Map<string, Entry[]>()
  for (const entry of entries) map.set(entry.group, [...(map.get(entry.group) ?? []), entry])
  return [...map]
    .map(([label, entries]) => ({
      label,
      entries: entries.toSorted(
        (a, b) =>
          Number(b.continues) - Number(a.continues) || a.label.localeCompare(b.label) || a.key.localeCompare(b.key),
      ),
    }))
    .toSorted((a, b) => a.label.localeCompare(b.label))
}

function commandShortcut(api: TuiPluginApi, name: string) {
  return useKeymapSelector((keymap) =>
    api.keys.formatSequence(
      keymap.getCommandBindings({ visibility: "registered", commands: [name] }).get(name)?.[0]?.sequence,
    ),
  )
}

function layout(value: unknown): Layout {
  if (value === "overlay") return "overlay"
  return "dock"
}

function HomeHint(props: { api: TuiPluginApi }) {
  const trigger = commandShortcut(props.api, command.toggle)
  const look = useMemo(() => skin(props.api), [])

  return (
    <Box width="100%" maxWidth={75} alignItems="center" paddingTop={1} flexShrink={0}>
      <Text color={look.muted} wrap="truncate-end">
        Show keyboard shortcuts with <Text color={look.subtle}>{trigger() || command.toggle}</Text>
      </Text>
    </Box>
  )
}

function WhichKeyPanel(props: {
  api: TuiPluginApi
  layout: Layout
  mode: () => Layout
  pendingPreview: () => boolean
  pinned: () => boolean
}) {
  const [terminalWidth, setTerminalWidth] = useState(80)
  const [terminalHeight, setTerminalHeight] = useState(24)
  const [offset, setOffset] = useState(0)
  const [activeGroup, setActiveGroup] = useState<string | undefined>()
  const pending = useKeymapSelector((keymap) => keymap.getPendingSequence())
  const active = useKeymapSelector((keymap) => keymap.getActiveKeys({ includeMetadata: true }))
  const pendingActive = useMemo(() => pending().length > 0 && active().length > 0, [pending, active])
  const pendingAutoVisible = useMemo(
    () => props.mode() === "overlay" && props.pendingPreview() && pendingActive,
    [props.mode(), props.pendingPreview(), pendingActive],
  )
  const visible = useMemo(() => props.pinned() || pendingAutoVisible, [props.pinned(), pendingAutoVisible])
  const pendingMode = useMemo(() => visible && pendingActive, [visible, pendingActive])
  const left = 0
  const width = useMemo(() => Math.max(1, terminalWidth), [terminalWidth])
  const panelHeight = useMemo(
    () => Math.max(MIN_PANEL_HEIGHT, Math.min(MAX_PANEL_HEIGHT, Math.floor(terminalHeight * PANEL_HEIGHT_RATIO))),
    [terminalHeight],
  )
  const contentWidth = useMemo(() => Math.max(1, width - 2), [width])
  const columns = useMemo(
    () => Math.max(1, Math.min(3, Math.floor((contentWidth + COLUMN_GAP) / (MAX_COLUMN_WIDTH + COLUMN_GAP)) || 1)),
    [contentWidth],
  )
  const entries = useMemo(() => active().map((item) => activeKeyEntry(props.api, item)), [active])
  const groups = useMemo(() => grouped(entries), [entries])
  const tabsVisible = useMemo(() => !pendingMode && groups.length > 0, [pendingMode, groups])
  const headerVisible = useMemo(() => tabsVisible || pendingMode, [tabsVisible, pendingMode])
  const footerVisible = useMemo(() => !pendingMode, [pendingMode])
  const rows = useMemo(
    () =>
      Math.max(
        1,
        panelHeight -
          PANEL_TOP_PADDING -
          (headerVisible ? 1 : 0) -
          (tabsVisible ? TAB_CONTENT_GAP : 0) -
          (footerVisible ? FOOTER_MARGIN + FOOTER_HEIGHT : 0),
      ),
    [panelHeight, headerVisible, tabsVisible, footerVisible],
  )
  const pageSize = useMemo(() => rows * columns, [rows, columns])
  const currentGroup = useMemo(() => {
    return groups.find((item) => item.label === activeGroup) ?? groups[0]
  }, [activeGroup, groups])
  const activeEntries = useMemo(() => currentGroup?.entries ?? [], [currentGroup])
  const items = useMemo<Item[]>(() => {
    if (!pendingMode) return activeEntries
    return groups.flatMap((group) => [{ type: "group" as const, label: group.label }, ...group.entries])
  }, [pendingMode, activeEntries, groups])
  const maxOffset = useMemo(() => Math.max(0, items.length - pageSize), [items, pageSize])
  const shown = useMemo(() => {
    const columnsItems: Item[][] = []
    let index = offset
    for (let column = 0; column < columns && index < items.length; column++) {
      const list: Item[] = []
      while (list.length < rows && index < items.length) {
        list.push(items[index]!)
        index += 1
      }
      columnsItems.push(list)
    }
    return columnsItems
  }, [offset, columns, rows, items])
  const rowIndexes = useMemo(() => Array.from({ length: rows }, (_, index) => index), [rows])
  const trigger = commandShortcut(props.api, command.toggle)
  const modeTrigger = commandShortcut(props.api, command.toggleLayout)
  const upActive = useMemo(() => offset > 0, [offset])
  const downActive = useMemo(() => offset < maxOffset, [offset, maxOffset])
  const scrollable = useMemo(() => maxOffset > 0, [maxOffset])
  const headerItems = useMemo<HeaderItem[]>(
    () => [
      ...(tabsVisible ? groups.map((group) => ({ type: "tab" as const, group })) : []),
      ...(scrollable ? [{ type: "scroll" as const }] : []),
    ],
    [tabsVisible, groups, scrollable],
  )
  const tabGap = useMemo(() => {
    const itemCount = headerItems.length
    if (itemCount <= 1) return 0
    const itemWidth = headerItems.reduce(
      (sum, item) => sum + (item.type === "tab" ? item.group.label.length + 2 : 3),
      0,
    )
    return Math.max(MIN_TAB_GAP, Math.min(TAB_GAP, Math.floor((contentWidth - itemWidth) / (itemCount - 1))))
  }, [headerItems, contentWidth])
  const nextMode = useMemo(() => (props.mode() === "dock" ? "overlay" : "dock"), [props.mode()])
  const look = useMemo(() => skin(props.api), [])
  const columnWidth = useMemo(
    () => Math.max(1, Math.min(MAX_COLUMN_WIDTH, Math.floor((contentWidth - (columns - 1) * COLUMN_GAP) / columns))),
    [contentWidth, columns],
  )
  const clamp = (value: number) => Math.max(0, Math.min(maxOffset, value))
  const scroll = (delta: number) => setOffset((value) => clamp(value + delta))
  const moveGroup = (delta: number) => {
    if (pendingMode) return
    if (!groups.length) return
    const index = Math.max(
      0,
      groups.findIndex((item) => item.label === currentGroup?.label),
    )
    setActiveGroup(groups[(index + delta + groups.length) % groups.length]!.label)
    setOffset(0)
  }

  useBindings(() => ({
    priority: 1000,
    enabled: visible,
    commands: [
      {
        name: command.groupPrevious,
        title: "Previous key binding group",
        desc: "Show the previous which-key group",
        category: "System",
        run() { moveGroup(-1) },
      },
      {
        name: command.groupNext,
        title: "Next key binding group",
        desc: "Show the next which-key group",
        category: "System",
        run() { moveGroup(1) },
      },
      {
        name: command.scrollUp,
        title: "Scroll key bindings up",
        desc: "Scroll the which-key panel up",
        category: "System",
        run() { scroll(-columns) },
      },
      {
        name: command.scrollDown,
        title: "Scroll key bindings down",
        desc: "Scroll the which-key panel down",
        category: "System",
        run() { scroll(columns) },
      },
      {
        name: command.pageUp,
        title: "Page key bindings up",
        desc: "Page the which-key panel up",
        category: "System",
        run() { scroll(-pageSize) },
      },
      {
        name: command.pageDown,
        title: "Page key bindings down",
        desc: "Page the which-key panel down",
        category: "System",
        run() { scroll(pageSize) },
      },
      {
        name: command.home,
        title: "First key binding",
        desc: "Jump to the first which-key binding",
        category: "System",
        run() { setOffset(0) },
      },
      {
        name: command.end,
        title: "Last key binding",
        desc: "Jump to the last which-key binding",
        category: "System",
        run() { setOffset(maxOffset) },
      },
    ],
    bindings: pendingMode
      ? props.api.tuiConfig.keybinds.gather("which-key.scroll", scrollCommands)
      : props.api.tuiConfig.keybinds.gather("which-key.panel", panelCommands),
  }))

  useEffect(() => {
    if (pendingMode) return
    const group = currentGroup
    if (group?.label === activeGroup) return
    setActiveGroup(group?.label)
  }, [pendingMode, currentGroup])

  useEffect(() => {
    if (pendingMode) return
    setOffset(0)
  }, [activeGroup, pendingMode])

  useEffect(() => {
    if (!visible) setOffset(0)
  }, [visible])

  useEffect(() => {
    setOffset(0)
  }, [pending()])

  useEffect(() => {
    setOffset((value) => clamp(value))
  }, [maxOffset])

  if (!visible) return null

  return (
    <Box
      position={props.layout === "overlay" ? "absolute" : "relative"}
      zIndex={3500}
      left={left}
      bottom={props.layout === "overlay" ? 0 : undefined}
      width={terminalWidth}
      height={panelHeight}
      backgroundColor={look.panel}
      paddingLeft={1}
      paddingRight={1}
      paddingTop={1}
      flexShrink={0}
      flexDirection="column"
    >
      {headerVisible && (
        <Box width="100%" flexDirection="row" justifyContent="center" gap={tabGap} flexShrink={0}>
          {headerItems.map((item, index) => {
            if (item.type === "scroll") {
              return (
                <Box key={`scroll-${index}`} flexShrink={0}>
                  <Text wrap="truncate-end">
                    <Text color={upActive ? look.text : look.muted}>{'↑'}</Text>
                    <Text color={look.muted}> </Text>
                    <Text color={downActive ? look.text : look.muted}>{'↓'}</Text>
                  </Text>
                </Box>
              )
            }
            const selected = currentGroup?.label === item.group.label
            return (
              <Box
                key={item.group.label}
                paddingLeft={1}
                paddingRight={1}
                flexShrink={0}
                backgroundColor={selected ? look.tab : undefined}
                onClick={() => {
                  setActiveGroup(item.group.label)
                  setOffset(0)
                }}
              >
                <Text
                  color={selected ? look.tabText : look.muted}
                  bold={selected}
                  wrap="truncate-end"
                >
                  {item.group.label}
                </Text>
              </Box>
            )
          })}
        </Box>
      )}
      {tabsVisible && <Box height={TAB_CONTENT_GAP} flexShrink={0} />}
      <Box height={rows} flexShrink={0} flexDirection="column">
        {shown.length === 0 ? (
          <Text color={look.muted}>No reachable bindings</Text>
        ) : (
          rowIndexes.map((row) => (
            <Box key={row} width="100%" flexDirection="row" justifyContent="center" gap={COLUMN_GAP}>
              {shown.map((column, colIndex) => {
                const item = column[row]
                if (!item) return <Box key={colIndex} width={columnWidth} />
                if (item.type !== "entry") {
                  return (
                    <Box key={colIndex} width={columnWidth} flexDirection="row" gap={1} justifyContent="space-between">
                      <Text color={look.accent} bold wrap="truncate">
                        {item.label}
                      </Text>
                    </Box>
                  )
                }
                const binding = item as Entry
                return (
                  <Box key={colIndex} width={columnWidth} flexDirection="row" gap={1} justifyContent="space-between">
                    <Box flexGrow={1} minWidth={0}>
                      <Text color={binding.continues ? look.accent : look.muted} wrap="truncate">
                        {binding.label}
                      </Text>
                    </Box>
                    <Box flexShrink={0}>
                      <Text color={look.text} bold wrap="truncate">
                        {binding.key}
                      </Text>
                    </Box>
                  </Box>
                )
              })}
            </Box>
          ))
        )}
      </Box>
      {footerVisible && (
        <>
          <Box height={FOOTER_MARGIN} flexShrink={0} />
          <Box width="100%" flexDirection="row" justifyContent="space-between" flexShrink={0}>
            <Box>
              <Text color={look.text} wrap="truncate-end">
                toggle <Text color={look.subtle}>{trigger() || command.toggle}</Text>
              </Text>
            </Box>
            <Box>
              <Text color={look.text} wrap="truncate-end">
                {nextMode} <Text color={look.subtle}>{modeTrigger() || command.toggleLayout}</Text>
              </Text>
            </Box>
          </Box>
        </>
      )}
    </Box>
  )
}

const tui: TuiPlugin = async (api) => {
  const [pinned, setPinned] = useState(false)
  const [mode, setMode] = useState<Layout>(layout(api.kv.get(KV_LAYOUT, "dock")))
  const [pendingPreview, setPendingPreview] = useState(api.kv.get(KV_PENDING_PREVIEW, false))

  api.keymap.registerLayer({
    priority: LAYER_PRIORITY,
    commands: [
      {
        name: command.toggle,
        title: "Show key bindings",
        desc: "Toggle which-key overlay",
        category: "System",
        run() { setPinned((value) => !value) },
      },
      {
        name: command.toggleLayout,
        title: "Toggle key bindings layout",
        desc: "Switch which-key between dock and overlay mode",
        category: "System",
        run() {
          setMode((value) => {
            const next = value === "dock" ? "overlay" : "dock"
            api.kv.set(KV_LAYOUT, next)
            return next
          })
        },
      },
      {
        name: command.togglePending,
        title: "Toggle pending key preview",
        desc: "Automatically show which-key for pending key sequences in overlay mode",
        category: "System",
        run() {
          setPendingPreview((value) => {
            api.kv.set(KV_PENDING_PREVIEW, !value)
            return !value
          })
        },
      },
    ],
    bindings: api.tuiConfig.keybinds.gather("which-key.toggle", toggleCommands),
  })

  api.slots.register({
    order: 200,
    slots: {
      home_bottom() {
        return <HomeHint api={api} />
      },
      app() {
        return mode === "overlay" ? (
          <WhichKeyPanel api={api} layout="overlay" mode={() => mode} pendingPreview={() => pendingPreview} pinned={() => pinned} />
        ) : null
      },
      app_bottom() {
        return mode === "dock" ? (
          <WhichKeyPanel api={api} layout="dock" mode={() => mode} pendingPreview={() => pendingPreview} pinned={() => pinned} />
        ) : null
      },
    },
  })
}

const plugin: BuiltinTuiPlugin = {
  id: "which-key",
  enabled: false,
  tui,
}

export default plugin
