// @ts-nocheck
import React, { useMemo, useState } from "react"
import { Box, Text, useInput } from "ink"

export type VcsFileStatus = {
  file: string
  status: "added" | "deleted" | "modified" | string
  additions?: number
  deletions?: number
}

const OPTIONS = ["no", "yes"] as const

export type WorkspaceFileChangesChoice = (typeof OPTIONS)[number]

function statusLabel(status: VcsFileStatus["status"]): string {
  if (status === "added") return "A"
  if (status === "deleted") return "D"
  return "M"
}

function changeCountText(file: VcsFileStatus): string {
  return `${file.additions ? `+${file.additions}` : ""}${file.deletions ? ` -${file.deletions}` : ""}`
}

function changeCountWidth(file: VcsFileStatus): number {
  return changeCountText(file).length + 2
}

function truncateLeft(input: string, maxLength: number): string {
  if (maxLength <= 0) return ""
  if (input.length <= maxLength) return input
  return "…" + input.slice(input.length - maxLength + 1)
}

export type DialogWorkspaceFileChangesProps = {
  files: VcsFileStatus[]
  onSelect: (choice: WorkspaceFileChangesChoice) => void
  title?: string
  message?: string
}

export function DialogWorkspaceFileChanges(props: DialogWorkspaceFileChangesProps) {
  const [active, setActive] = useState<WorkspaceFileChangesChoice>("yes")
  const visibleCount = Math.min(props.files.length, 8)
  const fileNameWidth = useMemo(
    () =>
      48 -
      Math.max(
        Math.max(7, ...props.files.map(changeCountWidth)) - 7,
        0,
      ),
    [props.files],
  )

  function confirm() {
    props.onSelect(active)
  }

  useInput((input, key) => {
    if (key.return) {
      confirm()
      return
    }
    if (key.leftArrow) {
      const index = OPTIONS.indexOf(active)
      setActive(OPTIONS[Math.max(index - 1, 0)])
      return
    }
    if (key.rightArrow) {
      const index = OPTIONS.indexOf(active)
      setActive(OPTIONS[Math.min(index + 1, OPTIONS.length - 1)])
    }
  })

  const slice = props.files.slice(0, visibleCount)

  return (
    <Box flexDirection="column" gap={1} paddingX={2} paddingBottom={1}>
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold>{props.title ?? "File Changes Found"}</Text>
        <Text dimColor>esc</Text>
      </Box>
      <Box>
        <Text dimColor wrap="word">
          {props.message ?? "Do you want to move these changes with the session?"}
        </Text>
      </Box>
      <Box flexDirection="column">
        {slice.map((item, i) => (
          <Box key={`${item.file}-${i}`} flexDirection="row" justifyContent="space-between">
            <Box flexDirection="row" flexShrink={1} minWidth={0}>
              <Box width={2} flexShrink={0}>
                <Text dimColor>{statusLabel(item.status)}</Text>
              </Box>
              <Text dimColor wrap="none">
                {truncateLeft(item.file, fileNameWidth)}
              </Text>
            </Box>
            <Box flexDirection="row" gap={1} minWidth={7} flexShrink={0} justifyContent="flex-end">
              <Text>
                {item.additions ? <Text color="green">+{item.additions}</Text> : null}
                {item.deletions ? <Text color="red"> -{item.deletions}</Text> : null}
              </Text>
            </Box>
          </Box>
        ))}
      </Box>
      <Box flexDirection="row" justifyContent="flex-end" paddingBottom={1}>
        {OPTIONS.map((item) => (
          <Box key={item} paddingX={2} backgroundColor={item === active ? "blue" : undefined}>
            <Text color={item === active ? "white" : undefined}>{item}</Text>
          </Box>
        ))}
      </Box>
    </Box>
  )
}

DialogWorkspaceFileChanges.show = (
  files: VcsFileStatus[],
  options?: { title?: string; message?: string },
): Promise<WorkspaceFileChangesChoice | undefined> => {
  return new Promise((resolve) => {
    // Caller in React tree is expected to mount this component; this helper
    // preserves the OpenCode static API but resolution requires the host.
    resolve(undefined)
    void options
    void files
  })
}

export default DialogWorkspaceFileChanges
