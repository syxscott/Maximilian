// @ts-nocheck
import React, { useMemo, useState } from "react"
import { t } from "@max/i18n"
import { Box, Text, useInput } from "ink"
import SelectInput from "ink-select-input"

export type ExportFormat = "json" | "markdown" | "text" | "html"

export type ExportOptions = {
  format: ExportFormat
  includeToolCalls?: boolean
  includeTimestamps?: boolean
  includeThinking?: boolean
  prettyPrint?: boolean
}

export type DialogExportOptionsProps = {
  defaultFormat?: ExportFormat
  onConfirm?: (options: ExportOptions) => void | Promise<void>
  onCancel?: () => void
}

type FormatItem = {
  label: string
  value: ExportFormat
  description?: string
}

const FORMATS: FormatItem[] = [
  { label: "JSON", value: "json", description: "Machine-readable structured data" },
  { label: "Markdown", value: "markdown", description: "Human-readable formatted text" },
  { label: "Plain Text", value: "text", description: "Unformatted text only" },
  { label: "HTML", value: "html", description: "Web page renderable export" },
]

export function DialogExportOptions(props: DialogExportOptionsProps) {
  const [format, setFormat] = useState<ExportFormat>(props.defaultFormat ?? "markdown")
  const [includeToolCalls, setIncludeToolCalls] = useState(true)
  const [includeTimestamps, setIncludeTimestamps] = useState(false)
  const [includeThinking, setIncludeThinking] = useState(false)
  const [prettyPrint, setPrettyPrint] = useState(true)
  const [view, setView] = useState<"format" | "options">("format")

  useInput((input, key) => {
    if (key.escape) props.onCancel?.()
  })

  const formatItems = useMemo(
    () => FORMATS.map((f) => ({ label: f.label, value: f.value })),
    [],
  )

  const optionItems = useMemo(
    () => [
      {
        label: `Include tool calls: ${includeToolCalls ? "yes" : "no"}`,
        value: "toolCalls",
      },
      {
        label: `Include timestamps: ${includeTimestamps ? "yes" : "no"}`,
        value: "timestamps",
      },
      {
        label: `Include thinking: ${includeThinking ? "yes" : "no"}`,
        value: "thinking",
      },
      {
        label: `Pretty print: ${prettyPrint ? "yes" : "no"}`,
        value: "prettyPrint",
      },
      {
        label: "Export now",
        value: "submit",
      },
    ],
    [includeToolCalls, includeTimestamps, includeThinking, prettyPrint],
  )

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold>{t("tui.exportOptions")}</Text>
        <Text dimColor>esc</Text>
      </Box>
      <Box marginY={1}>
        <Text>Format: </Text>
        <Text color="cyan">{format}</Text>
      </Box>
      {view === "format" ? (
        <Box flexDirection="column">
          <Box marginBottom={1}>
            <Text dimColor>{t("tui.chooseAFormat")}</Text>
          </Box>
          <SelectInput
            items={formatItems}
            onSelect={(item) => {
              setFormat(item.value as ExportFormat)
              setView("options")
            }}
            itemComponent={({ isSelected, label, value }) => (
              <Box flexDirection="row">
                <Text color={isSelected ? "green" : undefined}>{label}</Text>
                {value === format && <Text dimColor> (current)</Text>}
              </Box>
            )}
          />
        </Box>
      ) : (
        <Box flexDirection="column">
          <SelectInput
            items={optionItems}
            onSelect={(item) => {
              switch (item.value) {
                case "toolCalls":
                  setIncludeToolCalls((v) => !v)
                  break
                case "timestamps":
                  setIncludeTimestamps((v) => !v)
                  break
                case "thinking":
                  setIncludeThinking((v) => !v)
                  break
                case "prettyPrint":
                  setPrettyPrint((v) => !v)
                  break
                case "submit":
                  void props.onConfirm?.({
                    format,
                    includeToolCalls,
                    includeTimestamps,
                    includeThinking,
                    prettyPrint,
                  })
                  break
              }
            }}
          />
        </Box>
      )}
    </Box>
  )
}

export default DialogExportOptions
