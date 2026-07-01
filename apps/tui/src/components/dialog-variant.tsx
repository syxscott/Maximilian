// @ts-nocheck
import React, { useMemo } from "react"
import { t } from "@max/i18n"
import { Box, Text } from "ink"
import SelectInput from "ink-select-input"

export type DialogVariantProps = {
  variants: string[]
  current?: string
  onSelect?: (variant: string | undefined) => void
}

export function DialogVariant(props: DialogVariantProps) {
  const items = useMemo(() => {
    return [
      {
        label: "Default",
        value: "__default__",
      },
      ...props.variants.map((variant) => ({
        label: variant,
        value: variant,
      })),
    ]
  }, [props.variants])

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold>{t("tui.selectVariant")}</Text>
        <Text dimColor>esc</Text>
      </Box>
      <Box marginTop={1}>
        <SelectInput
          items={items}
          initialIndex={
            items.findIndex((i) =>
              i.value === "__default__"
                ? props.current === undefined || props.current === "default"
                : i.value === props.current,
            )
          }
          onSelect={(item) => {
            if (item.value === "__default__") {
              props.onSelect?.(undefined)
            } else {
              props.onSelect?.(item.value)
            }
          }}
          itemComponent={({ isSelected, label, value }) => (
            <Box flexDirection="row">
              <Text color={isSelected ? "green" : undefined}>{label}</Text>
              {value === props.current && <Text dimColor> (current)</Text>}
            </Box>
          )}
        />
      </Box>
    </Box>
  )
}

export default DialogVariant
