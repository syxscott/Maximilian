import React, { useCallback, useEffect, useState } from "react"
import { t } from "@max/i18n"
import { Box, Text, useInput } from "ink"
import Spinner from "ink-spinner"

import type { UsageSummary } from "../api"
import { useSDK } from "../context/sdk"
import { useWindows } from "../hooks/useWindows"
import { cacheHitRate, pickWindow, unpricedCount, usageMetricsFromSummary } from "./usage-model"
import "../locales/tui-panels"

/**
 * Usage panel — the TUI face of GET /api/obs/usage/summary: the three core
 * metrics (totalRequests / totalTokens / totalCost) as a compact three-line
 * readout, with the dashboard's honest "—" when the window contained
 * unpriced requests (totalCostUsdKnown === false). Deepened with a cache
 * hit-rate line (cache reads over the honest grand total), a yellow
 * unpriced-request count line shown only when the cost total is partial,
 * and a rolling-window line under the summary (GET /api/obs/usage/windows
 * via the useWindows hook): 24h requests / tokens / cost, with the same
 * honest "—" when the window contains unpriced requests (costUsd null).
 * r refreshes, esc closes.
 */
export function UsagePanel() {
  const sdk = useSDK()
  const [summary, setSummary] = useState<UsageSummary | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)
  // Rolling windows (5h/24h/7d/30d) — same r-key cadence as the summary.
  const { windows, refresh: refreshWindows } = useWindows()

  const refresh = useCallback(() => {
    setNonce((n) => n + 1)
    refreshWindows()
  }, [refreshWindows])

  useEffect(() => {
    const ctrl = new AbortController()
    let cancelled = false

    async function load() {
      setIsLoading(true)
      try {
        const res = await sdk.client.get<UsageSummary>("/api/obs/usage/summary?range=today")
        if (cancelled || ctrl.signal.aborted) return
        setSummary(res)
        setError(null)
      } catch (err) {
        if (cancelled || ctrl.signal.aborted) return
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled && !ctrl.signal.aborted) setIsLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
      ctrl.abort()
    }
  }, [sdk.client, nonce])

  useInput((input) => {
    if (input === "r") refresh()
  })

  const metrics = summary != null ? usageMetricsFromSummary(summary) : null
  // Deepened disclosures: cache hit rate (read tokens over the grand total)
  // and the unpriced-request count (only when the cost total is partial).
  const hitRate = summary != null ? cacheHitRate(summary) : null
  const unpriced = summary != null ? unpricedCount(summary) : null
  // The rolling 24h window under the three summary lines; hidden entirely
  // when the endpoint returned no matching bucket (honest absence).
  const window24h = pickWindow(windows, "24h")

  return (
    <Box flexDirection="column" paddingLeft={1} paddingRight={1}>
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold>{t("tui.usage", "Usage")}</Text>
        <Text dimColor>esc</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        {isLoading && summary === null ? (
          <Text color="gray">
            <Spinner type="dots" /> {t("tui.usage.loading", "Loading usage…")}
          </Text>
        ) : error ? (
          <Text color="red">
            {t("tui.usage.error", { error }, `Failed to load usage: ${error}`)}
          </Text>
        ) : metrics === null ? (
          <Text color="gray">{t("tui.usage.loading", "Loading usage…")}</Text>
        ) : (
          <>
            <Text>
              {" "}
              {t("tui.usage.requests", "requests")}: {metrics.requests}
            </Text>
            <Text>
              {" "}
              {t("tui.usage.tokens", "tokens")}: {metrics.tokens}
            </Text>
            <Text>
              {" "}
              {t("tui.usage.cost", "cost")}: {metrics.cost}
            </Text>
            {window24h !== null ? (
              <Text color="magenta">
                {" "}
                {t("tui.usage.window24h", "24h window")} · {t("tui.usage.requests", "requests")}{" "}
                {window24h.requests} · {t("tui.usage.tokens", "tokens")} {window24h.tokens} ·{" "}
                {t("tui.usage.cost", "cost")} {window24h.cost}
              </Text>
            ) : null}
            {hitRate !== null ? (
              <Text color="cyan">
                {" "}
                {t("tui.usage.cacheHitRate", "cache hit")}: {hitRate.toFixed(1)}%
              </Text>
            ) : null}
            {unpriced !== null ? (
              <Text color="yellow">
                {" "}
                ⚠ {t("tui.usage.unpriced", { count: unpriced }, "unpriced requests: {count}")}
              </Text>
            ) : null}
          </>
        )}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>{t("tui.goals.hints", "r refresh · esc close")}</Text>
      </Box>
    </Box>
  )
}

export default UsagePanel
