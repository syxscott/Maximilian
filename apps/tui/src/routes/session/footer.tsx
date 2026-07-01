// @ts-nocheck
/**
 * Footer: bottom bar showing directory, connection status, MCP/LSP counts.
 *
 * Ported from OpenCode's SolidJS `footer.tsx`. The original used
 * `createMemo`, `createStore`, `onMount`/`onCleanup`, and `<Switch>`/`<Match>`;
 * we port to React `useMemo`, `useState`, `useEffect`, and conditional JSX.
 */

import React, { useEffect, useMemo, useState } from "react"
import { Box, Text } from "ink"
import { useTheme } from "../../context/theme"
import { useSync } from "../../context/sync"
import { useRoute } from "../../context/route"
import { useConnected } from "../../components/use-connected"

export function Footer() {
  const { theme } = useTheme()
  const sync = useSync()
  const route = useRoute()
  const connected = useConnected()

  const mcp = useMemo(
    () =>
      Object.values(sync.data.mcp as Record<string, { status: string }>).filter(
        (x) => x.status === "connected",
      ).length,
    [sync.data.mcp],
  )

  const mcpError = useMemo(
    () => Object.values(sync.data.mcp as Record<string, { status: string }>).some((x) => x.status === "failed"),
    [sync.data.mcp],
  )

  const lsp = useMemo(() => Object.keys(sync.data.lsp as Record<string, unknown>), [sync.data.lsp])

  const permissions = useMemo(() => {
    if (route.data.type !== "session") return []
    return (sync.data.permission as Record<string, unknown[]>)?.[(route.data as { sessionID: string }).sessionID] ?? []
  }, [sync.data.permission, route.data])

  const directory = useMemo(() => {
    // In the original, directory came from a dedicated context. We approximate
    // by reading the project path from sync data.
    return (sync.data as Record<string, unknown>).path as string | undefined ?? ""
  }, [sync.data])

  const [welcome, setWelcome] = useState(false)

  useEffect(() => {
    const timeouts: ReturnType<typeof setTimeout>[] = []

    function tick() {
      if (connected) return
      if (!welcome) {
        setWelcome(true)
        timeouts.push(setTimeout(() => tick(), 5000))
        return
      }
      if (welcome) {
        setWelcome(false)
        timeouts.push(setTimeout(() => tick(), 10_000))
        return
      }
    }

    timeouts.push(setTimeout(() => tick(), 10_000))

    return () => {
      timeouts.forEach(clearTimeout)
    }
  }, [connected, welcome])

  return (
    <Box flexDirection="row" justifyContent="space-between" flexShrink={0}>
      <Text dimColor>{directory}</Text>
      <Box gap={2} flexDirection="row" flexShrink={0}>
        {welcome ? (
          <Text>
            Get started <Text dimColor>/connect</Text>
          </Text>
        ) : connected ? (
          <>
            {permissions.length > 0 ? (
              <Text color={theme.warning}>
                {permissions.length} Permission{permissions.length > 1 ? "s" : ""}
              </Text>
            ) : null}
            <Text>
              <Text color={lsp.length > 0 ? theme.success : theme.textMuted}>*</Text> {lsp.length} LSP
            </Text>
            {mcp > 0 ? (
              <Text>
                <Text color={mcpError ? theme.error : theme.success}>@</Text> {mcp} MCP
              </Text>
            ) : null}
            <Text dimColor>/status</Text>
          </>
        ) : null}
      </Box>
    </Box>
  )
}
