// @ts-nocheck
import React, { useMemo, useState } from "react"
import { Box, Text, useInput } from "ink"
import SelectInput from "ink-select-input"
import { t } from "@max/i18n"

export type StashEntry = {
  input: string
  timestamp: number
}

export type DialogStashProps = {
  entries: StashEntry[]
  deleteHint?: string
  onSelect?: (entry: StashEntry) => void
  onDelete?: (index: number) => void
}

function getRelativeTime(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (seconds < 60) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 7) return `${days}d ago`
  const date = new Date(timestamp)
  return date.toISOString()
}

function getStashPreview(input: string, maxLength = 50): string {
  const firstLine = input.split("\n")[0].trim()
  if (firstLine.length <= maxLength) return firstLine
  return firstLine.slice(0, Math.max(0, maxLength - 1)) + "…"
}

export function DialogStash(props: DialogStashProps) {
  const [toDelete, setToDelete] = useState<number | undefined>(undefined)

  useInput((input, key) => {
    if (key.escape) {
      setToDelete(undefined)
    }
  })

  const items = useMemo(() => {
    return props.entries
      .map((entry, index) => {
        const isDeleting = toDelete === index
        const lineCount = (entry.input.match(/\n/g)?.length ?? 0) + 1
        return {
          label: isDeleting
            ? `Press ${props.deleteHint ?? "delete"} again to confirm`
            : getStashPreview(entry.input),
          value: index,
          description: getRelativeTime(entry.timestamp),
          footer: lineCount > 1 ? `~${lineCount} lines` : undefined,
        }
      })
      .reverse()
  }, [props.entries, toDelete, props.deleteHint])

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold>{t("tui.stash")}</Text>
        <Text dimColor>esc</Text>
      </Box>
      <Box marginTop={1}>
        <SelectInput
          items={items}
          onSelect={(item) => {
            const entry = props.entries[item.value]
            if (entry) {
              props.onSelect?.(entry)
            }
          }}
          itemComponent={({ isSelected, label, value, description, footer }) => (
            <Box flexDirection="row" justifyContent="space-between">
              <Box flexDirection="row">
                <Text color={isSelected ? "green" : toDelete === value ? "red" : undefined}>
                  {label}
                </Text>
                {description && <Text dimColor>  {description}</Text>}
              </Box>
              {footer && <Text dimColor>{footer}</Text>}
            </Box>
          )}
        />
      </Box>
      {toDelete !== undefined && (
        <Box marginTop={1}>
          <Text color="red">{t("tui.confirmRemoval")}</Text>
        </Box>
      )}
    </Box>
  )
}

DialogStash.confirmDelete = (item: { value: number }, current?: number, set?: (n?: number) => void, remove?: (n: number) => void) => {
  if (current === item.value) {
    remove?.(item.value)
    set?.(undefined)
    return
  }
  set?.(item.value)
}

export default DialogStash
