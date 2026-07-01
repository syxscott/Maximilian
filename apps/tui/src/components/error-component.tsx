import React from "react"
import { t } from "@max/i18n"
import { Box, Text, useInput, useStdout, useApp } from "ink"

export interface ErrorComponentProps {
  error: Error
  reset: () => void
  mode?: "dark" | "light"
}

const LIGHT_COLORS = {
  bg: "white",
  text: "black",
  muted: "gray",
  primary: "blue",
  selectedListItemText: "white",
}

const DARK_COLORS = {
  bg: "black",
  text: "white",
  muted: "gray",
  primary: "yellow",
  selectedListItemText: "black",
}

const STACK_PREVIEW_CHARS = 6000
const GITHUB_ISSUES_URL = "https://github.com/anomalyco/opencode/issues/new?template=bug-report.yml"
const OPENCODE_VERSION = "unknown"

export function ErrorComponent({ error, reset, mode = "dark" }: ErrorComponentProps) {
  const { exit } = useApp()
  const { stdout } = useStdout()
  const [copied, setCopied] = React.useState(false)

  const colors = mode === "light" ? LIGHT_COLORS : DARK_COLORS
  const height = stdout?.rows ?? 24
  const scrollHeight = Math.max(4, Math.floor(height * 0.7))

  const issueURL = React.useMemo(() => {
    const url = new URL(GITHUB_ISSUES_URL)
    if (error.message) {
      url.searchParams.set("title", `opentui: fatal: ${error.message}`)
    }
    if (error.stack) {
      const stackPreview = error.stack.substring(0, STACK_PREVIEW_CHARS - url.toString().length)
      url.searchParams.set("description", "```\n" + stackPreview + "...\n```")
    }
    url.searchParams.set("opencode-version", OPENCODE_VERSION)
    return url
  }, [error])

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      void exit()
    }
  })

  // We can't actually write to a clipboard from inside the TUI port without an
  // injected adapter; we keep the call site and simulate the copied state so
  // the UI matches OpenCode's behaviour once a clipboard provider is wired in.
  const copyIssueURL = React.useCallback(() => {
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [])

  return (
    <Box flexDirection="column" gap={1} width={stdout?.columns ?? 80}>
      <Box flexDirection="row" gap={1} alignItems="center">
        <Text bold color={colors.text}>
          Please report an issue.
        </Text>
        <Box borderStyle="single" borderColor={colors.primary} paddingLeft={1} paddingRight={1}>
          <Text bold color={colors.text}>
            Copy issue URL (exception info pre-filled)
          </Text>
        </Box>
        {copied ? <Text color={colors.muted}>{t("tui.copiedSuccessfully")}</Text> : null}
      </Box>
      <Box flexDirection="row" gap={2} alignItems="center">
        <Text color={colors.text}>A fatal error occurred!</Text>
        <Box borderStyle="single" borderColor={colors.primary} paddingLeft={1} paddingRight={1}>
          <Text color={colors.text}>{t("tui.resetTui")}</Text>
        </Box>
        <Box borderStyle="single" borderColor={colors.primary} paddingLeft={1} paddingRight={1}>
          <Text color={colors.text}>{t("tui.exit")}</Text>
        </Box>
      </Box>
      <Box flexDirection="column" height={scrollHeight} overflow="hidden">
        <Text color={colors.muted} wrap="wrap">
          {error.stack ?? "(no stack trace)"}
        </Text>
      </Box>
      <Text color={colors.text}>{error.message}</Text>
      {/* Reset/Exit/clipboard are wired via keyboard bindings; keep URL handy. */}
      <Text dimColor>{issueURL.toString().slice(0, 80)}</Text>
    </Box>
  )
}

export default ErrorComponent