// @ts-nocheck
import React, { useEffect, useMemo, useState } from "react"
import { Box, Text, useInput } from "ink"
import SelectInput from "ink-select-input"
import { t } from "@max/i18n"

export type McpStatus = {
  status: "connected" | "failed" | "disabled" | "needs_auth" | "needs_client_registration" | string
  error?: string
}

export type DialogMcpProps = {
  mcps: Record<string, McpStatus>
  isEnabled?: (name: string) => boolean
  onToggle?: (name: string) => Promise<void> | void
  onRefresh?: () => Promise<Record<string, McpStatus>>
}

function Status(props: { enabled: boolean; loading: boolean }) {
  if (props.loading) return <Text dimColor>... Loading</Text>
  if (props.enabled) return <Text color="green" bold>{"✓"} Enabled</Text>
  return <Text dimColor>{"○"} Disabled</Text>
}

export function DialogMcp(props: DialogMcpProps) {
  const [loading, setLoading] = useState<string | null>(null)
  const [mcps, setMcps] = useState<Record<string, McpStatus>>(props.mcps)

  useEffect(() => {
    setMcps(props.mcps)
  }, [props.mcps])

  const items = useMemo(() => {
    return Object.keys(mcps)
      .sort((a, b) => a.localeCompare(b))
      .map((name) => {
        const status = mcps[name]
        return {
          label: name,
          value: name,
          description: status.status === "failed" ? "failed" : status.status,
          footer: (
            <Status enabled={!!props.isEnabled?.(name)} loading={loading === name} />
          ),
        }
      })
  }, [mcps, loading, props.isEnabled])

  const actions = useMemo(
    () => [
      {
        title: "toggle",
        onTrigger: async (option: { value: string }) => {
          if (loading !== null) return
          setLoading(option.value)
          try {
            await props.onToggle?.(option.value)
            if (props.onRefresh) {
              const data = await props.onRefresh()
              if (data) setMcps(data)
            }
          } finally {
            setLoading(null)
          }
        },
      },
    ],
    [loading, props.onToggle, props.onRefresh],
  )

  useInput((input, key) => {
    if (key.return) {
      // selection handled by SelectInput
    }
  })

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold>{t("tui.mcps")}</Text>
        <Text dimColor>esc</Text>
      </Box>
      <Box marginTop={1}>
        <SelectInput
          items={items}
          onSelect={() => {
            // Don't close on select, only on escape
          }}
          itemComponent={({ isSelected, label, value, description, footer }) => (
            <Box flexDirection="row" justifyContent="space-between">
              <Box flexDirection="row">
                <Text color={isSelected ? "green" : undefined}>{label}</Text>
                {description && <Text dimColor>  {description}</Text>}
              </Box>
              <Box>{footer as React.ReactNode}</Box>
              <Text dimColor>{actions[0]?.title} [{value}]</Text>
            </Box>
          )}
        />
      </Box>
    </Box>
  )
}

export default DialogMcp
