import React, { useEffect, useMemo, useState } from "react"
import { t } from "@max/i18n"
import { Box, Text, useInput } from "ink"

import { useSDK } from "../context/sdk"
import { useToast } from "./toast"
import {
  clampSettingsCursor,
  settingsSectionsView,
  TUI_THEME_SWITCHING_SUPPORTED,
} from "./settings-model"
import "../locales/tui-panels"

/**
 * Settings dialog — the TUI face of the dashboard's settings center.
 *
 * A section list first (j/k + arrows to move, Enter to open — the same
 * navigation grammar as the other dialogs), then the dashboard sections that
 * HAVE a TUI face:
 *
 *   - Appearance: theme switching. The TUI ships the theme catalog and a
 *     picker component, but the ported theme context's set() is a no-op
 *     stub (src/context/theme.tsx), so this section is honestly marked
 *     "dashboard-only" instead of opening a picker that changes nothing —
 *     see TUI_THEME_SWITCHING_SUPPORTED in settings-model.ts.
 *   - Jobs: swaps the dialog for the JobsDialog (the settings dialog is
 *     dialog.replace()ed, so Enter IS "switch to the jobs view").
 *   - Memory / Usage: same swap for the corresponding panels.
 *
 * Data-backed sections (jobs/memory/usage) are gated by a lightweight
 * GET /api/health probe: a definitive failure dims the row with the reason
 * and Enter explains instead of opening a panel that can only show an error.
 * An unknown probe state (still probing) keeps the rows open — the panels
 * own their loading/error three-state.
 */
export interface SettingsDialogProps {
  /** Opens the jobs dialog (replaces this dialog — the "switch view" link). */
  onOpenJobs: () => void
  /** Opens the memory panel. */
  onOpenMemory: () => void
  /** Opens the usage panel. */
  onOpenUsage: () => void
}

export function SettingsDialog(props: SettingsDialogProps) {
  const sdk = useSDK()
  const toast = useToast()
  const [cursor, setCursor] = useState(0)

  // API reachability probe: one cheap GET /api/health on mount. null = still
  // probing / no probe available (an SDK context without a health client —
  // a test stub, say) — availability treats that as "unknown", which keeps
  // the API-backed rows open and lets their own error states speak.
  const [apiReachable, setApiReachable] = useState<boolean | null>(null)
  useEffect(() => {
    const ctrl = new AbortController()
    let cancelled = false
    const client = sdk?.client as { health?: unknown } | undefined
    if (typeof client?.health !== "function") return
    void (client.health as (signal?: AbortSignal) => Promise<unknown>)(ctrl.signal)
      .then(() => {
        if (!cancelled && !ctrl.signal.aborted) setApiReachable(true)
      })
      .catch(() => {
        if (!cancelled && !ctrl.signal.aborted) setApiReachable(false)
      })
    return () => {
      cancelled = true
      ctrl.abort()
    }
  }, [sdk?.client])

  const rows = useMemo(
    () =>
      settingsSectionsView(undefined, {
        apiReachable,
        themeSwitchable: TUI_THEME_SWITCHING_SUPPORTED,
      }),
    [apiReachable],
  )

  const safeCursor = clampSettingsCursor(cursor, rows.length)
  const selectedRow = rows[safeCursor]

  function openSelected() {
    if (!selectedRow) return
    if (selectedRow.availability.state === "unavailable") {
      // Explain instead of opening a face that can only show an error (or,
      // for Appearance, a picker that would change nothing).
      toast.show({
        variant: "info",
        message: t(selectedRow.availability.reasonKey, selectedRow.availability.reason),
        duration: 2500,
      })
      return
    }
    switch (selectedRow.section.target) {
      case "jobs-dialog":
        props.onOpenJobs()
        return
      case "memory-panel":
        props.onOpenMemory()
        return
      case "usage-panel":
        props.onOpenUsage()
        return
      case "theme":
        // Unreachable while TUI_THEME_SWITCHING_SUPPORTED is false (the
        // availability gate above catches it). When the theme context grows
        // a real set(), flip the flag and open DialogThemeList here.
        return
      default:
        return
    }
  }

  useInput((input, key) => {
    if (key.upArrow || input === "k") {
      setCursor(clampSettingsCursor(safeCursor - 1, rows.length))
      return
    }
    if (key.downArrow || input === "j") {
      setCursor(clampSettingsCursor(safeCursor + 1, rows.length))
      return
    }
    if (key.return) {
      openSelected()
      return
    }
  })

  return (
    <Box flexDirection="column" paddingLeft={1} paddingRight={1}>
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold>
          {t("tui.settings", "Settings")}
          {rows.length > 0 ? ` (${rows.length})` : ""}
        </Text>
        <Text dimColor>esc</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        {rows.map((row, index) => {
          const selected = index === safeCursor
          const available = row.availability.state === "available"
          return (
            <Box key={row.section.id} flexDirection="row">
              <Text color={selected ? "green" : undefined}>{selected ? "❯" : " "}</Text>
              <Text> </Text>
              <Text color={available ? (selected ? "green" : undefined) : "gray"} bold={selected}>
                {t(row.section.titleKey, row.section.title)}
              </Text>
              <Text dimColor> · {t(row.section.hintKey, row.section.hint)}</Text>
              {row.availability.state === "unavailable" ? (
                <Text color="yellow">
                  {" "}
                  — {t(row.availability.reasonKey, row.availability.reason)}
                </Text>
              ) : null}
            </Box>
          )
        })}
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>{t("tui.settings.hints", "j/k move · Enter open · esc close")}</Text>
      </Box>
    </Box>
  )
}

export default SettingsDialog
