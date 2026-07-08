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
 */

import { Loader2 } from "lucide-react";
import { useLiveUsage } from "../hooks/useLiveUsage";
import { formatTokens as fmtTokens, formatPercent as fmtPercent } from "@max/i18n";

export interface LiveUsagePillProps {
  onOpenUsage: () => void;
}

export function LiveUsagePill({ onOpenUsage }: LiveUsagePillProps) {
  const { data, isLoading, isError } = useLiveUsage();

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
    );
  }

  // No data yet (e.g. evolution disabled) or all polls failed.
  if (!data || data.totalRequests === 0) {
    return (
      <button
        type="button"
        onClick={onOpenUsage}
        className="px-2.5 py-1 rounded-md border border-border bg-muted/30 text-xs text-muted-foreground hover:bg-muted/50 transition-colors"
        aria-label="No usage yet — open usage tab"
      >
        💰 $0.0000 · 0 tok today
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpenUsage}
      title={
        isError
          ? "Last poll failed — click to open Usage"
          : `Today: ${data.totalRequests} requests · ${fmtTokens(data.totalTokens)} tokens`
      }
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs transition-colors ${
        isError
          ? "border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/15"
          : "border-border bg-muted/30 text-foreground hover:bg-muted/60"
      }`}
      aria-label="Open usage panel"
    >
      <span aria-hidden="true">💰</span>
      <span className="font-mono tabular-nums">${data.totalCostUsd.toFixed(4)}</span>
      <span className="text-muted-foreground">·</span>
      <span className="font-mono tabular-nums">{fmtTokens(data.totalTokens)}</span>
      {data.cacheHitRate > 0 && (
        <>
          <span className="text-muted-foreground">·</span>
          <span className="font-mono tabular-nums">{fmtPercent(data.cacheHitRate, 0)} cache</span>
        </>
      )}
    </button>
  );
}