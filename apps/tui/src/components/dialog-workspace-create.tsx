import React, { useEffect, useMemo, useState } from "react"
import { t } from "@max/i18n"
import { Box, Text, useInput } from "ink"
import TextInput from "ink-text-input"
import SelectInput from "ink-select-input"

export type ExperimentalWorkspaceAdapterListResponse = Array<{
  type: string
  name: string
  description?: string
}>

export type Workspace = {
  id: string
  name: string
  type: string
  directory?: string
  timeUsed?: number | string
}

export type WorkspaceSelection =
  | { type: "none" }
  | { type: "new"; workspaceType: string; workspaceName: string }
  | { type: "existing"; workspaceID: string; workspaceType: string; workspaceName: string }

type WorkspaceSelectValue = WorkspaceSelection | { type: "existing-list" }

type SelectItem = { label: string; value: WorkspaceSelectValue; description?: string }

function recentConnectedWorkspaces<
  WorkspaceInfo extends { id: string; timeUsed?: number | string },
>(input: {
  workspaces: readonly WorkspaceInfo[]
  status: (workspaceID: string) => string | undefined
  limit?: number
  omitWorkspaceID?: string
}) {
  const allWorkspaces = input.workspaces.filter((workspace) => input.status(workspace.id) === "connected")
  const workspaces = [...allWorkspaces].sort(
    (a, b) => Number(b.timeUsed ?? 0) - Number(a.timeUsed ?? 0),
  )
  const recent = workspaces.slice(0, input.limit ?? 3)
  return { recent, hasMore: recent.length < workspaces.length }
}

export function warpReminderText(dir: string) {
  return `<system-reminder>The user has changed the current working directory to "${dir}". This is still the same project but at a possibly new location; take this into account when working with any files from now on.</system-reminder>`
}

export type DialogWorkspaceSelectProps = {
  adapters?: ExperimentalWorkspaceAdapterListResponse
  workspaces: Workspace[]
  statusOf?: (id: string) => string | undefined
  omittedWorkspaceID?: string
  onSelect?: (selection: WorkspaceSelection) => void | Promise<void>
  onRequestExistingList?: () => void
}

export function DialogWorkspaceSelect(props: DialogWorkspaceSelectProps) {
  const [adapters, setAdapters] = useState<ExperimentalWorkspaceAdapterListResponse | undefined>(
    props.adapters,
  )
  const [view, setView] = useState<"main" | "existing">("main")

  useEffect(() => {
    if (props.adapters && !adapters) setAdapters(props.adapters)
  }, [props.adapters, adapters])

  const items: SelectItem[] = useMemo(() => {
    if (view === "existing") {
      const list = props.workspaces
        .filter((w) => props.statusOf?.(w.id) === "connected")
        .filter((w) => w.id !== props.omittedWorkspaceID)
        .map((workspace) => ({
          label: workspace.name,
          description: `(${workspace.type})`,
          value: {
            type: "existing" as const,
            workspaceID: workspace.id,
            workspaceType: workspace.type,
            workspaceName: workspace.name,
          },
        }))
      return list
    }

    const list = adapters
    if (!list) return []
    const { recent, hasMore } = recentConnectedWorkspaces({
      workspaces: props.workspaces,
      status: (id) => props.statusOf?.(id),
      omitWorkspaceID: props.omittedWorkspaceID,
    })
    const out: SelectItem[] = [
      ...list.map((adapter) => ({
        label: adapter.name,
        description: adapter.description,
        value: {
          type: "new" as const,
          workspaceType: adapter.type,
          workspaceName: adapter.name,
        },
      })),
      {
        label: "None",
        description: "Use the local project",
        value: { type: "none" as const },
      },
      ...recent.map((workspace) => ({
        label: workspace.name,
        description: `(${workspace.type})`,
        value: {
          type: "existing" as const,
          workspaceID: workspace.id,
          workspaceType: workspace.type,
          workspaceName: workspace.name,
        },
      })),
    ]
    if (hasMore) {
      out.push({
        label: "View all workspaces",
        description: "Choose from all workspaces",
        value: { type: "existing-list" as const },
      })
    }
    return out
  }, [adapters, view, props.workspaces, props.statusOf, props.omittedWorkspaceID])

  if (!adapters) return <Text dimColor>Loading adapters...</Text>

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold>{view === "main" ? "Warp" : "Existing Workspace"}</Text>
        <Text dimColor>esc</Text>
      </Box>
      <Box marginTop={1}>
        <SelectInput
          items={items}
          onSelect={(item) => {
            const v = item.value
            if (v.type === "existing-list") {
              setView("existing")
              props.onRequestExistingList?.()
              return
            }
            void props.onSelect?.(v)
          }}
        />
      </Box>
    </Box>
  )
}

export type DialogWorkspaceCreateProps = {
  onSubmit?: (name: string) => void
  onCancel?: () => void
}

export function DialogWorkspaceCreate(props: DialogWorkspaceCreateProps) {
  const [name, setName] = useState("")

  useInput((input, key) => {
    if (key.escape) props.onCancel?.()
  })

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold>{t("tui.createWorkspace")}</Text>
        <Text dimColor>esc</Text>
      </Box>
      <Box marginTop={1}>
        <Text>Name: </Text>
        <TextInput
          value={name}
          onChange={setName}
          onSubmit={(value) => {
            if (value.trim().length > 0) props.onSubmit?.(value.trim())
          }}
        />
      </Box>
    </Box>
  )
}

export default DialogWorkspaceSelect
