import React, { useEffect, useState } from "react"
import { Box, Text, useInput } from "ink"
import TextInput from "ink-text-input"
import { t } from "@max/i18n"

export type DialogSessionRenameProps = {
  session: string
  initial?: string
  onConfirm?: (value: string) => void | Promise<void>
  onCancel?: () => void
}

export function DialogSessionRename(props: DialogSessionRenameProps) {
  const [value, setValue] = useState(props.initial ?? "")

  useEffect(() => {
    if (props.initial !== undefined) setValue(props.initial)
  }, [props.initial])

  useInput((input, key) => {
    if (key.escape) props.onCancel?.()
  })

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold>{t("tui.renameSession")}</Text>
        <Text dimColor>esc</Text>
      </Box>
      <Box marginTop={1}>
        <Text>New title: </Text>
        <TextInput
          value={value}
          onChange={setValue}
          onSubmit={(v) => {
            const trimmed = v.trim()
            if (trimmed.length === 0) return
            void props.onConfirm?.(trimmed)
          }}
        />
      </Box>
    </Box>
  )
}

export default DialogSessionRename
