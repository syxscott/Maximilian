import React, { useEffect, useMemo, useState } from "react"
import { t } from "@max/i18n"
import { Box, Text, useInput } from "ink"
import SelectInput from "ink-select-input"

export type Workspace = {
  id: string
  name: string
  type: string
  directory?: string
}

type WorkspaceOption = { workspace: Workspace }

type Item = {
  label: string
  value: WorkspaceOption
  footer?: string
  status?: "connected" | "disconnected"
  directory?: string
}

export type DialogWorkspaceListProps = {
  workspaces: Workspace[]
  statusOf?: (id: string) => "connected" | "disconnected" | undefined
  onSelect?: (workspace: Workspace) => void
  onDelete?: (workspace: Workspace) => Promise<void> | void
}

export function DialogWorkspaceList(props: DialogWorkspaceListProps) {
  const [deleting, setDeleting] = useState<string | undefined>(undefined)
  const [removing, setRemoving] = useState<string | undefined>(undefined)

  const items: Item[] = useMemo(() => {
    return [...props.workspaces]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((workspace) => ({
        label:
          removing === workspace.id
            ? "Deleting..."
            : deleting === workspace.id
              ? `Delete ${workspace.name}? Press delete again`
              : workspace.name,
        value: { workspace },
        footer: workspace.type,
        status: props.statusOf?.(workspace.id),
        directory: workspace.directory,
      }))
  }, [props.workspaces, removing, deleting, props.statusOf])

  useInput((input, key) => {
    if (key.delete) {
      const ws = props.workspaces.find((w) => deleting === w.id)
      if (ws) {
        setDeleting(undefined)
        void (async () => {
          setRemoving(ws.id)
          try {
            await props.onDelete?.(ws)
          } finally {
            setRemoving(undefined)
          }
        })()
      }
    }
  })

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold>{t("tui.workspaces")}</Text>
        <Text dimColor>esc</Text>
      </Box>
      <Box marginTop={1}>
        <SelectInput
          items={items}
          onSelect={(item) => {
            setDeleting((prev) => (prev === item.value.workspace.id ? prev : item.value.workspace.id))
            props.onSelect?.(item.value.workspace)
          }}
          itemComponent={({ isSelected, label }) => (
            <Text color={isSelected ? "green" : undefined}>{label}</Text>
          )}
        />
      </Box>
      {deleting && (
        <Box marginTop={1}>
          <Text color="red">{t("tui.confirmRemoval")}</Text>
        </Box>
      )}
    </Box>
  )
}

export default DialogWorkspaceList
