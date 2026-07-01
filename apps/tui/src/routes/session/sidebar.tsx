/**
 * Sidebar: session metadata panel (title, workspace, share URL, version).
 *
 * Ported from OpenCode's SolidJS `sidebar.tsx`. The original used
 * `createMemo`, `<Show>`, `<scrollbox>`, and plugin runtime slots.
 * We port to React `useMemo`, conditional JSX, and ink `<Box>` primitives.
 * Plugin runtime slots are rendered as no-ops (the stub Slot returns null).
 */

import React, { useMemo } from "react"
import { Box, Text } from "ink"
import { useSync } from "../../context/sync"
import { useTheme } from "../../context/theme"
import { useProject } from "../../context/project"
import { usePluginRuntime } from "../../context"
import { WorkspaceLabel } from "../../components/workspace-label"

type Session = {
  id: string
  title?: string
  parentID?: string
  share?: { url?: string }
  workspaceID?: string
  [k: string]: unknown
}

export function Sidebar(props: { sessionID: string; overlay?: boolean }) {
  const pluginRuntime = usePluginRuntime()
  const project = useProject()
  const sync = useSync()
  const { theme } = useTheme()

  const session = useMemo(
    () => (sync.data.session as Session[]).find((s) => s.id === props.sessionID),
    [sync.data.session, props.sessionID],
  )

  const workspace = useMemo(() => {
    const workspaceID = session?.workspaceID
    if (!workspaceID) return undefined
    return project.workspace.get(workspaceID)
  }, [session?.workspaceID, project])

  if (!session) return null

  const Slot = pluginRuntime.Slot

  return (
    <Box
      flexDirection="column"
      width={42}
      height="100%"
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={2}
      paddingRight={2}
      borderStyle="single"
      borderColor={theme.border}
    >
      <Box flexDirection="column" flexShrink={0} gap={1} paddingRight={1}>
        <Slot name="sidebar_title" />

        <Box paddingRight={1} flexDirection="column">
          <Text bold color={theme.text}>
            {session.title ?? "Untitled"}
          </Text>
          {session.workspaceID ? (
            <Text dimColor>
              {workspace ? (
                <WorkspaceLabel
                  type={workspace.type ?? "unknown"}
                  name={workspace.id}
                  status={(project.workspace.status?.(workspace.id) as any) ?? "error"}
                  icon
                />
              ) : (
                <WorkspaceLabel type="unknown" name={session.workspaceID} status="error" icon />
              )}
            </Text>
          ) : null}
          {session.share?.url ? <Text dimColor>{session.share.url}</Text> : null}
        </Box>

        <Slot name="sidebar_content" />
      </Box>

      <Box flexShrink={0} gap={1} paddingTop={1}>
        <Slot name="sidebar_footer" />
        <Text dimColor>
          <Text color={theme.success}>*</Text> <Text bold>Open</Text>
          <Text bold>Code</Text>
        </Text>
      </Box>
    </Box>
  )
}
