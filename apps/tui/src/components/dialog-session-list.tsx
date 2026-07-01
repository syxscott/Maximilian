// @ts-nocheck
import React, { useEffect, useMemo, useState } from "react"
import { t } from "@max/i18n"
import { Box, Text, useInput } from "ink"
import TextInput from "ink-text-input"
import SelectInput from "ink-select-input"
import Spinner from "ink-spinner"

export type SessionItem = {
  id: string
  title: string
  parentID?: string
  directory?: string
  path?: string
  time: { updated: number; created?: number }
  workspaceID?: string
}

export type SessionStatus = {
  type: string
}

type SelectItem = {
  label: string
  value: string
  category?: string
  footer?: string
  prefix?: React.ReactNode
}

function debounce<T extends (...args: any[]) => void>(fn: T, wait: number): T {
  let timer: ReturnType<typeof setTimeout> | undefined
  return ((...args: any[]) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => fn(...args), wait)
  }) as T
}

function orderByRecency(sessions: SessionItem[]): string[] {
  return sessions
    .filter((x) => x.parentID === undefined)
    .sort((a, b) => b.time.updated - a.time.updated)
    .map((x) => x.id)
}

function quickSwitchRange(first: string, last: string): string {
  const prefix = first.slice(0, -1)
  if (first.endsWith("1") && last === `${prefix}9`) return `${prefix}1-9`
  return `${first} through ${last}`
}

export type DialogSessionListProps = {
  sessions: SessionItem[]
  sessionStatus?: Record<string, SessionStatus>
  pinned?: string[]
  slots?: string[]
  currentSessionID?: string
  deleteHint?: string
  quickSwitch1?: string
  quickSwitch9?: string
  onSelect?: (session: SessionItem) => void
  onTogglePin?: (sessionID: string) => void
  onDelete?: (session: SessionItem) => Promise<void> | void
  onRename?: (session: SessionItem) => void
}

export function DialogSessionList(props: DialogSessionListProps) {
  const [toDelete, setToDelete] = useState<string | undefined>(undefined)
  const [search, setSearch] = useState("")
  const [searchResults, setSearchResults] = useState<SessionItem[] | undefined>(undefined)

  const debouncedSet = useMemo(
    () => debounce((value: string) => setSearch(value), 150),
    [],
  )

  const sessions = searchResults ?? props.sessions

  const browseOrder = useMemo(() => orderByRecency(props.sessions), [props.sessions])

  const quickSwitchHint = useMemo(() => {
    const first = props.quickSwitch1
    const last = props.quickSwitch9
    if (!first || !last) return undefined
    return quickSwitchRange(first, last)
  }, [props.quickSwitch1, props.quickSwitch9])

  const items: SelectItem[] = useMemo(() => {
    const today = new Date().toDateString()
    const sessionMap = new Map(sessions.map((x) => [x.id, x]))
    const displayOrder = searchResults ? orderByRecency(searchResults) : browseOrder

    const pinned = (props.pinned ?? []).filter((id) => sessionMap.has(id))
    const pinnedSet = new Set(pinned)
    const slotByID = new Map<string, number>((props.slots ?? []).map((id, i) => [id, i + 1]))

    const buildOption = (id: string, category: string): SelectItem | undefined => {
      const x = sessionMap.get(id)
      if (!x) return undefined
      const isDeleting = toDelete === x.id
      const status = props.sessionStatus?.[x.id]
      const isWorking = status?.type === "busy" || status?.type === "retry"
      const slot = slotByID.get(x.id)
      const prefix = isWorking ? (
        <Text color="green">
          <Spinner type="dots" />
        </Text>
      ) : slot !== undefined ? (
        <Text color="cyan">{slot}</Text>
      ) : undefined

      return {
        label: isDeleting ? `Press ${props.deleteHint ?? "delete"} again to confirm` : x.title,
        value: x.id,
        category,
        prefix,
      }
    }

    const remaining = displayOrder
      .filter((id) => !pinnedSet.has(id))
      .map((id) => {
        const x = sessionMap.get(id)
        if (!x) return undefined
        const label = new Date(x.time.updated).toDateString()
        return buildOption(id, label === today ? "Today" : label)
      })
      .filter((x): x is SelectItem => x !== undefined)

    return [
      ...pinned.map((id) => buildOption(id, "Pinned")).filter((x): x is SelectItem => x !== undefined),
      ...remaining,
    ]
  }, [sessions, searchResults, browseOrder, toDelete, props.sessionStatus, props.slots, props.pinned, props.deleteHint])

  const footerHints = useMemo(() => {
    if (!quickSwitchHint || (props.slots ?? []).length === 0) return []
    return [{ title: "switch", label: quickSwitchHint }]
  }, [quickSwitchHint, props.slots])

  useInput((input, key) => {
    if (key.escape) {
      setToDelete(undefined)
    }
  })

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold>{t("tui.sessions")}</Text>
        <Text dimColor>esc</Text>
      </Box>
      <Box marginY={1}>
        <Text>Search: </Text>
        <TextInput value={search} onChange={(v) => { setSearchResults(undefined); debouncedSet(v) }} />
      </Box>
      <Box>
        <SelectInput
          items={items}
          onSelect={(item) => {
            const session = sessions.find((s) => s.id === item.value)
            if (session) props.onSelect?.(session)
          }}
          itemComponent={({ isSelected, label, value, prefix }) => (
            <Box flexDirection="row">
              {prefix ? prefix : null}
              <Text> </Text>
              <Text color={isSelected ? "green" : toDelete === value ? "red" : undefined}>
                {label}
              </Text>
            </Box>
          )}
        />
      </Box>
      {footerHints.length > 0 && (
        <Box marginTop={1}>
          {footerHints.map((h) => (
            <Text key={h.title} dimColor>
              {h.title}: {h.label}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  )
}

export default DialogSessionList
