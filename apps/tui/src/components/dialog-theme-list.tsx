import React, { useEffect, useMemo, useState } from "react"
import { t } from "@max/i18n"
import { Box, Text, useInput } from "ink"
import SelectInput from "ink-select-input"

export type DialogThemeListProps = {
  themes: string[]
  initial: string
  onSelect?: (theme: string) => void
  onPreview?: (theme: string) => void
  onCancel?: () => void
}

export function DialogThemeList(props: DialogThemeListProps) {
  const sorted = useMemo(
    () =>
      [...props.themes].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })),
    [props.themes],
  )
  const [confirmed, setConfirmed] = useState(false)
  const [active, setActive] = useState<string | undefined>(props.initial)

  useEffect(() => {
    if (active !== undefined) props.onPreview?.(active)
  }, [active, props.onPreview])

  useInput((input, key) => {
    if (key.escape && !confirmed) {
      props.onPreview?.(props.initial)
      props.onCancel?.()
    }
  })

  const items = sorted.map((value) => ({ label: value, value }))

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold>{t("tui.themes")}</Text>
        <Text dimColor>esc</Text>
      </Box>
      <Box marginTop={1}>
        <SelectInput
          items={items}
          initialIndex={sorted.indexOf(props.initial)}
          onSelect={(item) => {
            setConfirmed(true)
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
    </Box>
  )
}

export default DialogThemeList
