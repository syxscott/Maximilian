import React, { useCallback, useEffect, useState } from "react"
import { t } from "@max/i18n"
import { Box, Text, useInput } from "ink"
import Spinner from "ink-spinner"

import type { UsageSummary } from "../api"
import { useSDK } from "../context/sdk"
import { cacheHitRate, unpricedCount, usageMetricsFromSummary } from "./usage-model"
import "../locales/tui-panels"

/**
 * Usage panel — the TUI face of GET /api/obs/usage/summary: the three core
 * metrics (totalRequests / totalTokens / totalCost) as a compact three-line
 * readout, with the dashboard's honest "—" when the window contained
 * unpriced requests (totalCostUsdKnown === false). Deepened with a cache
 * hit-rate line (cache reads over the honest grand total) and a yellow
 * unpriced-request count line shown only when the cost total is partial.
 * r refreshes, esc closes.
 */
export function UsagePanel() {
  const sdk = useSDK()
  const [summary, setSummary] = useState<UsageSummary | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  const refresh = useCallback(() => setNonce((n) => n + 1), [])

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
