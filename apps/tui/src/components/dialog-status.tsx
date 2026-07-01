// @ts-nocheck
import React, { useMemo } from "react"
import { Box, Text, useInput } from "ink"
import { t } from "@max/i18n"

export type FormatterInfo = {
  name: string
  enabled?: boolean
}

export type PluginInfo = { name: string; version?: string }

export type LspInfo = {
  id: string
  root: string
  status: "connected" | "error" | string
}

export type StatusMcpItem = {
  status: "connected" | "failed" | "disabled" | "needs_auth" | "needs_client_registration" | string
  error?: string
}

export type DialogStatusProps = {
  formatters: FormatterInfo[]
  plugins: Array<string | [string, ...unknown[]]>
  mcps: Record<string, StatusMcpItem>
  lsps: LspInfo[]
  onClose?: () => void
}

const STATUS_COLOR: Record<string, string> = {
  connected: "green",
  failed: "red",
  disabled: "gray",
  needs_auth: "yellow",
  needs_client_registration: "red",
  error: "red",
}

function fileURLToPath(value: string): string {
  return value.replace(/^file:\/\//, "")
}

function parsePlugin(item: string | [string, ...unknown[]]): PluginInfo {
  const value = typeof item === "string" ? item : item[0]
  if (value.startsWith("file://")) {
    const path = fileURLToPath(value)
    const parts = path.split("/")
    const filename = parts.pop() || path
    if (!filename.includes(".")) return { name: filename }
    const basename = filename.split(".")[0]
    if (basename === "index") {
      const dirname = parts.pop()
      const name = dirname || basename
      return { name }
    }
    return { name: basename }
  }
  const index = value.lastIndexOf("@")
  if (index <= 0) return { name: value, version: "latest" }
  return { name: value.substring(0, index), version: value.substring(index + 1) }
}

function mcpStatusText(key: string, item: StatusMcpItem): string {
  switch (item.status) {
    case "connected":
      return "Connected"
    case "failed":
      return item.error ?? "Failed"
    case "disabled":
      return "Disabled in configuration"
    case "needs_auth":
      return `Needs authentication (run: opencode mcp auth ${key})`
    case "needs_client_registration":
      return item.error ?? "Needs client registration"
    default:
      return item.status
  }
}

export function DialogStatus(props: DialogStatusProps) {
  const enabledFormatters = useMemo(
    () => props.formatters.filter((f) => f.enabled),
    [props.formatters],
  )
  const plugins = useMemo(
    () => props.plugins.map(parsePlugin).sort((a, b) => a.name.localeCompare(b.name)),
    [props.plugins],
  )

  useInput((input, key) => {
    if (key.escape) props.onClose?.()
  })

  const mcpEntries = Object.entries(props.mcps)
  const showMcp = mcpEntries.length > 0
  const showLsp = props.lsps.length > 0
  const showFormatters = enabledFormatters.length > 0
  const showPlugins = plugins.length > 0

  return (
    <Box flexDirection="column" paddingX={2} paddingBottom={1} gap={1}>
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold>{t("tui.status")}</Text>
        <Text dimColor>esc</Text>
      </Box>

      {showMcp ? (
        <Box flexDirection="column">
          <Text>{mcpEntries.length} MCP Servers</Text>
          {mcpEntries.map(([key, item]) => (
            <Box key={key} flexDirection="row" gap={1}>
              <Text color={STATUS_COLOR[item.status]} flexShrink={0}>•</Text>
              <Text wrap="word">
                <Text bold>{key}</Text>{" "}
                <Text dimColor>{mcpStatusText(key, item)}</Text>
              </Text>
            </Box>
          ))}
        </Box>
      ) : (
        <Text>{t("tui.noMcpServers")}</Text>
      )}

      {showLsp && (
        <Box flexDirection="column">
          <Text>{props.lsps.length} LSP Servers</Text>
          {props.lsps.map((item) => (
            <Box key={item.id} flexDirection="row" gap={1}>
              <Text color={STATUS_COLOR[item.status]} flexShrink={0}>•</Text>
              <Text wrap="word">
                <Text bold>{item.id}</Text> <Text dimColor>{item.root}</Text>
              </Text>
            </Box>
          ))}
        </Box>
      )}

      {showFormatters ? (
        <Box flexDirection="column">
          <Text>{enabledFormatters.length} Formatters</Text>
          {enabledFormatters.map((item) => (
            <Box key={item.name} flexDirection="row" gap={1}>
              <Text color="green" flexShrink={0}>•</Text>
              <Text wrap="word" bold>{item.name}</Text>
            </Box>
          ))}
        </Box>
      ) : (
        <Text>{t("tui.noFormatters")}</Text>
      )}

      {showPlugins ? (
        <Box flexDirection="column">
          <Text>{plugins.length} Plugins</Text>
          {plugins.map((item) => (
            <Box key={item.name} flexDirection="row" gap={1}>
              <Text color="green" flexShrink={0}>•</Text>
              <Text wrap="word">
                <Text bold>{item.name}</Text>
                {item.version && <Text dimColor> @{item.version}</Text>}
              </Text>
            </Box>
          ))}
        </Box>
      ) : (
        <Text>{t("tui.noPlugins")}</Text>
      )}
    </Box>
  )
}

export default DialogStatus
