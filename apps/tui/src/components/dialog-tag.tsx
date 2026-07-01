// @ts-nocheck
import React, { useEffect, useMemo, useState } from "react"
import { Box, Text } from "ink"
import TextInput from "ink-text-input"
import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "./dialog"
import { useProject } from "../context/project"
import { useSDK } from "../context/sdk"

export type DialogTagProps = {
  onSelect?: (value: string) => void
}

type Option = { value: string; title: string }

export function DialogTag(props: DialogTagProps) {
  const sdk = useSDK()
  const dialog = useDialog()
  const project = useProject()

  const [filter, setFilter] = useState("")
  const [files, setFiles] = useState<string[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoaded(false)
    void sdk.client.find
      ?.files?.({ query: filter, workspace: project.workspace.current() ?? undefined })
      .then((result: { data?: string[]; error?: unknown }) => {
        if (cancelled) return
        if (result.error) {
          setFiles([])
        } else {
          const list: string[] = (result.data ?? []).slice(0, 5)
          setFiles(list)
        }
        setLoaded(true)
      })
      .catch(() => {
        if (cancelled) return
        setFiles([])
        setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [filter, project])

  const options: Option[] = useMemo(
    () => files.map((file) => ({ value: file, title: file })),
    [files],
  )

  return (
    <Box flexDirection="column">
      <Box paddingLeft={1} paddingRight={1}>
        <TextInput value={filter} onChange={setFilter} />
      </Box>
      {loaded && (
        <DialogSelect
          title="Autocomplete"
          options={options}
          onSelect={(option: Option) => {
            props.onSelect?.(option.value)
            dialog.clear()
          }}
        />
      )}
    </Box>
  )
}
