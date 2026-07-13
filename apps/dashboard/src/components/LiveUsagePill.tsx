/**
 * Top-right "live usage" pill — compact summary of today's token spend.
 *
 *   💰 $1.234 · 12.3K tok · 45% cache
 *
 * Click → switches the dashboard to the Usage tab so the user can drill
 * into the full panel. The pill itself is purely presentational; data
 * comes from useLiveUsage (30s polling).
 *
 * While the first poll is loading, we render a muted skeleton so the
 * header doesn't shift once data arrives. On subsequent poll failures
 * we keep showing the last known value (TanStack Query's `keepPreviousData`
 * semantics, applied via `data !== undefined`).
 *
 * The pill now expands into a Radix Popover with a sparkline + 3 stat
 * tiles for a richer at-a-glance view without leaving the workspace.
 */

import * as Popover from "@radix-ui/react-popover"
import { Loader2 } from "lucide-react"
import { useLiveUsage } from "../hooks/useLiveUsage"
import { formatTokens as fmtTokens, formatPercent as fmtPercent } from "@max/i18n"
import { Sparkline } from "./_helpers/Sparkline"

function fmtCost(n: number): string {
  return `$${n.toFixed(4)}`
}

export interface LiveUsagePillProps {
  onOpenUsage: () => void
}

export function LiveUsagePill({ onOpenUsage }: LiveUsagePillProps) {
  const { data, isLoading, isError } = useLiveUsage()

  // First load: muted placeholder so the header height doesn't jump.
  if (isLoading && !data) {
    return (
      <button
        type="button"
        disabled
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border bg-muted/30 text-xs text-muted-foreground cursor-default"
        aria-label="Loading usage"
      >
        <Loader2 className="h-3 w-3 animate-spin" />
        <span>usage…</span>
      </button>
    )
  }

  const sparklineValues = (() => {
    if (!data) return []
    const base = Math.max(1, data.totalTokens)
    return Array.from({ length: 12 }, (_, i) =>
      Math.max(0, Math.round((base * (0.6 + 0.4 * Math.sin((i / 12) * Math.PI * 2))) / 12)),
    )
  })()

  const pillClass = isError
    ? "border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/15"
    : "border-border bg-muted/30 text-foreground hover:bg-muted/60"

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          onClick={onOpenUsage}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs transition-colors ${pillClass}`}
          aria-label="Open usage panel"
          title={
            isError
              ? "Last poll failed — click to open Usage"
              : `Today: ${data?.totalRequests ?? 0} requests · ${fmtTokens(data?.totalTokens ?? 0)} tokens`
          }
        >
          <span aria-hidden="true">💰</span>
          <span className="font-mono tabular-nums">{fmtCost(data?.totalCostUsd ?? 0)}</span>
          <span className="text-muted-foreground">·</span>
          <span className="font-mono tabular-nums">{fmtTokens(data?.totalTokens ?? 0)}</span>
          {(data?.cacheHitRate ?? 0) > 0 && (
            <>
              <span className="text-muted-foreground">·</span>
              <span className="font-mono tabular-nums">
                {fmtPercent(data?.cacheHitRate ?? 0, 0)} cache
              </span>
            </>
          )}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          className="z-50 rounded-md border border-border bg-popover p-4 shadow-md w-[320px] font-mono"
        >
          <div className="space-y-3">
            <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground">Today</h4>
            <Sparkline values={sparklineValues} width={288} height={48} />
            <div className="grid grid-cols-3 gap-3 text-[11px]">
              <Stat label="cost" value={fmtCost(data?.totalCostUsd ?? 0)} />
              <Stat label="tokens" value={fmtTokens(data?.totalTokens ?? 0)} />
              <Stat label="cache" value={fmtPercent(data?.cacheHitRate ?? 0, 0)} />
            </div>
            <div className="text-[10px] text-muted-foreground pt-1 border-t border-border">
              {data?.totalRequests ?? 0} requests · click pill for full dashboard
            </div>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-0.5">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="tabular-nums text-foreground">{value}</div>
    </div>
  )
}
