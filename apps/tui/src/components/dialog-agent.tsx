// @ts-nocheck
import React, { useMemo } from "react"
import { t } from "@max/i18n"
import { Box, Text } from "ink"
import SelectInput from "ink-select-input"

export type AgentItem = {
  name: string
  native?: boolean
  description?: string
}

export type DialogAgentProps = {
  agents: AgentItem[]
  current?: string
  onSelect?: (agent: AgentItem) => void
}

export function DialogAgent(props: DialogAgentProps) {
  const items = useMemo(() => {
    return props.agents.map((item) => ({
      label: item.name,
      value: item,
      description: item.native ? "native" : item.description,
    }))
  }, [props.agents])

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold>{t("tui.selectAgent")}</Text>
        <Text dimColor>esc</Text>
      </Box>
      <Box marginTop={1}>
        <SelectInput
          items={items}
          onSelect={(item) => props.onSelect?.(item.value)}
          itemComponent={({ isSelected, label, value }) => (
            <Box flexDirection="row">
              <Text color={isSelected ? "green" : undefined}>{label}</Text>
              {props.current === value.name && <Text dimColor> (current)</Text>}
            </Box>
          )}
        />
      </Box>
    </Box>
  )
}

export default DialogAgent
