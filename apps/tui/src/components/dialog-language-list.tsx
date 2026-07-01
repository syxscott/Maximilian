import React, { useEffect, useMemo, useState } from "react"
import { Box, Text, useInput } from "ink"
import SelectInput from "ink-select-input"
import { listLocales, getLocale, setLocale, localeDisplayName, t, type Locale } from "@max/i18n"

/**
 * Language picker dialog. Triggered by the `/language` slash command from the
 * TUI App. Selecting a locale calls `setLocale()` immediately — the React
 * tree re-renders on its own because `useLocale()` subscribes to changes —
 * and pops a toast confirming the switch.
 */
export type DialogLanguageListProps = {
  onSelect?: (locale: Locale) => void
  onCancel?: () => void
}

export function DialogLanguageList(props: DialogLanguageListProps) {
  const initial = getLocale()
  const sorted = useMemo(
    () =>
      [...listLocales()].sort((a, b) =>
        localeDisplayName(a).localeCompare(localeDisplayName(b), undefined, { sensitivity: "base" }),
      ),
    [],
  )
  const [active, setActive] = useState<string | undefined>(initial)

  useInput((input, key) => {
    if (key.escape) {
      props.onCancel?.()
    }
  })

  const items: Array<{ label: string; value: Locale }> = sorted.map((value) => ({
    label: `${localeDisplayName(value)} (${value})`,
    value,
  }))

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold>{t("tui.language")}</Text>
        <Text dimColor>{t("tui.esc")}</Text>
      </Box>
      <Box marginTop={1}>
        <SelectInput
          items={items}
          initialIndex={Math.max(0, sorted.indexOf(initial))}
          onSelect={(item) => {
            setLocale(item.value)
            props.onSelect?.(item.value)
          }}
          onHighlight={(item) => {
            setActive(item.value)
          }}
          itemComponent={({ isSelected, label }) => (
            <Text color={isSelected ? "green" : undefined}>{label}</Text>
          )}
        />
      </Box>
      {active ? (
        <Box marginTop={1}>
          <Text dimColor>{active}</Text>
        </Box>
      ) : null}
    </Box>
  )
}

// useEffect import kept for parity with DialogThemeList; will be wired when
// preview-then-confirm flow lands.
void useEffect

export default DialogLanguageList
