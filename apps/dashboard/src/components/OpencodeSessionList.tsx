/**
 * OpencodeSessionList — read-only panel of live opencode sessions.
 *
 * 借鉴 opencode: the opencode web UI shows a session picker with status
 * pills (idle / busy / error). We render the same shape over Maximilian's
 * local projection (see `OpencodeStateStore` + `useOpencodeSessions`):
 *
 *   ┌───────────────────────────────────────────────────────────────┐
 *   │  Active opencode sessions                          live ●     │
 *   ├───────────────────────────────────────────────────────────────┤
 *   │ ● busy   ws-1   42 msg · 12 tool   2s ago    message:part   ▾ │
 *   │ ○ idle   ws-2   11 msg ·  3 tool   3m ago    session:idle  ▸ │
 *   └───────────────────────────────────────────────────────────────┘
 *
 * Click a row → expand inline to show the recent event stream with type,
 * timestamp, and a brief payload summary.
 */

import { useState } from "react"
import { Loader2, ChevronDown, ChevronRight, Radio, RefreshCw } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useLocale, t } from "@max/i18n"
import {
  useOpencodeSessions,
  fetchOpencodeSession,
  type OpencodeSession,
  type OpencodeSessionDetail,
} from "../hooks/useOpencodeSessions"

export interface OpencodeSessionListProps {
  className?: string
  /** Initial poll interval, also used after the SSE drops. */
  pollIntervalMs?: number
  /** Disable the SSE stream — useful in tests/storybooks. */
  disableLive?: boolean
}

// ── small helpers ──────────────────────────────────────────────────────────

function formatRelative(iso: string): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return iso
  const delta = Math.max(0, Date.now() - t)
  if (delta < 5_000) return "just now"
  if (delta < 60_000) return `${Math.floor(delta / 1000)}s ago`
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`
  return `${Math.floor(delta / 86_400_000)}d ago`
}

const STATUS_VARIANT: Record<
  OpencodeSession["status"],
  { variant: "default" | "secondary" | "destructive" | "outline"; className: string; label: string }
> = {
  busy: { variant: "default", className: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30", label: "Busy" },
  idle: { variant: "secondary", className: "bg-muted text-muted-foreground", label: "Idle" },
  retry: { variant: "outline", className: "bg-amber-500/15 text-amber-700 border-amber-500/30", label: "Retry" },
  error: { variant: "destructive", className: "", label: "Error" },
  compacting: { variant: "outline", className: "bg-sky-500/15 text-sky-700 border-sky-500/30", label: "Compacting" },
  unknown: { variant: "outline", className: "", label: "Unknown" },
}

function StatusBadge({ status }: { status: OpencodeSession["status"] }) {
  const cfg = STATUS_VARIANT[status] ?? STATUS_VARIANT.unknown
  return (
    <Badge variant={cfg.variant} className={cn("font-mono text-[10px] uppercase", cfg.className)}>
      {cfg.label}
    </Badge>
  )
}

function summarizeData(type: string, data: unknown): string {
  if (data === null || data === undefined) return ""
  if (typeof data !== "object") return String(data)
  const obj = data as Record<string, unknown>
  switch (type) {
    case "message:delta": {
      const text = obj.text ?? obj.delta
      return typeof text === "string" ? text.slice(0, 120) : ""
    }
    case "message:part": {
      const part = obj.part
      if (part && typeof part === "object") {
        const p = part as Record<string, unknown>
        const text = p.text ?? p.content
        if (typeof text === "string") return text.slice(0, 120)
        const tool = p.tool ?? p.name
        if (typeof tool === "string") return `tool=${tool}`
      }
      return ""
    }
    case "tool:called":
    case "tool:success":
    case "tool:failed":
    case "tool:progress": {
      const tool = obj.tool
      const callID = obj.callID
      const pieces: string[] = []
      if (typeof tool === "string") pieces.push(`tool=${tool}`)
      if (typeof callID === "string") pieces.push(`call=${callID.slice(0, 8)}`)
      return pieces.join(" ")
    }
    case "session:error": {
      const err = obj.error
      if (err && typeof err === "object") {
        const msg = (err as Record<string, unknown>).message
        if (typeof msg === "string") return msg.slice(0, 120)
      }
      if (typeof err === "string") return err.slice(0, 120)
      return ""
    }
    default: {
      // Generic summary — show first two scalar fields we find.
      const scalars: string[] = []
      for (const [k, v] of Object.entries(obj)) {
        if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
          scalars.push(`${k}=${v}`)
          if (scalars.length >= 2) break
        }
      }
      return scalars.join(" ")
    }
  }
}

// ── row + expansion ────────────────────────────────────────────────────────

interface SessionRowProps {
  session: OpencodeSession
  onToggle: () => void
  expanded: boolean
}

function SessionRow({ session, onToggle, expanded }: SessionRowProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      className="w-full text-left px-3 py-2 rounded-md hover:bg-muted/60 transition-colors flex items-center gap-3 group"
      data-testid={`opencode-session-${session.sessionId}`}
    >
      <span className="text-muted-foreground">
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        )}
      </span>
      <StatusBadge status={session.status} />
      <span className="font-mono text-xs truncate flex-1" title={session.sessionId}>
        {session.sessionId}
      </span>
      <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
        {session.messageCount} msg · {session.toolCallCount} tool
      </span>
      <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap w-20 text-right">
        {formatRelative(session.lastEventAt)}
      </span>
    </button>
  )
}

interface ExpandedRowProps {
  detail: OpencodeSessionDetail | null
  loading: boolean
  error: Error | null
}

function ExpandedRow({ detail, loading, error }: ExpandedRowProps) {
  if (loading) {
    return (
      <div className="px-9 py-3 text-xs text-muted-foreground flex items-center gap-2">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
        Loading events…
      </div>
    )
  }
  if (error) {
    return (
      <div className="px-9 py-3 text-xs text-destructive">
        Failed to load events: {error.message}
      </div>
    )
  }
  if (!detail || detail.recent.length === 0) {
    return (
      <div className="px-9 py-3 text-xs text-muted-foreground">
        No events yet.
      </div>
    )
  }
  return (
    <ul className="px-9 py-2 space-y-1" data-testid="opencode-session-events">
      {detail.recent
        .slice()
        .reverse()
        .map((ev) => {
          const summary = summarizeData(ev.type, ev.data)
          return (
            <li
              key={ev.id}
              className="text-xs flex items-baseline gap-2 font-mono py-1"
              data-testid="opencode-event-row"
            >
              <span className="text-muted-foreground tabular-nums w-20 shrink-0">
                {formatRelative(ev.timestamp)}
              </span>
              <span className="text-foreground/80 w-44 shrink-0 truncate">{ev.type}</span>
              <span className="text-muted-foreground truncate flex-1" title={summary}>
                {summary}
              </span>
              <span className="text-muted-foreground/60 tabular-nums shrink-0">
                #{ev.seq}
              </span>
            </li>
          )
        })}
    </ul>
  )
}

// ── main component ─────────────────────────────────────────────────────────

export function OpencodeSessionList({
  className,
  pollIntervalMs,
  disableLive,
}: OpencodeSessionListProps) {
  useLocale()
  const { sessions, loading, error, generatedAt, live, refetch } = useOpencodeSessions({
    ...(pollIntervalMs !== undefined ? { pollIntervalMs } : {}),
    ...(disableLive !== undefined ? { disableLive } : {}),
  })

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<OpencodeSessionDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<Error | null>(null)

  async function toggle(id: string) {
    if (expandedId === id) {
      setExpandedId(null)
      setDetail(null)
      setDetailError(null)
      return
    }
    setExpandedId(id)
    setDetail(null)
    setDetailError(null)
    setDetailLoading(true)
    try {
      const d = await fetchOpencodeSession(id)
      if (expandedId !== id && id !== expandedId) {
        // User clicked another row mid-fetch — let the newer toggle win.
      }
      setDetail(d)
    } catch (err) {
      setDetailError(err instanceof Error ? err : new Error(String(err)))
    } finally {
      setDetailLoading(false)
    }
  }

  return (
    <Card className={cn("font-sans", className)} data-testid="opencode-session-list">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          {t("opencode.sessions.title")}
          <span
            className={cn(
              "inline-flex items-center gap-1 text-[10px] font-mono uppercase",
              live ? "text-emerald-600" : "text-muted-foreground",
            )}
            title={live ? "SSE live" : "Polling only"}
            data-testid="opencode-live-indicator"
          >
            <Radio className={cn("h-3 w-3", live && "animate-pulse")} aria-hidden="true" />
            {live ? "live" : "poll"}
          </span>
        </CardTitle>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("opencode.sessions.refresh")}
          onClick={() => {
            void refetch()
          }}
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-1">
        {loading && sessions.length === 0 ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
            {t("opencode.sessions.loading")}
          </div>
        ) : error && sessions.length === 0 ? (
          <div className="text-xs text-destructive py-2">{error.message}</div>
        ) : sessions.length === 0 ? (
          <div className="text-xs text-muted-foreground py-2">
            {t("opencode.sessions.empty")}
          </div>
        ) : (
          <div className="space-y-1">
            {sessions.map((s) => (
              <div key={s.sessionId} className="space-y-0">
                <SessionRow
                  session={s}
                  expanded={expandedId === s.sessionId}
                  onToggle={() => {
                    void toggle(s.sessionId)
                  }}
                />
                {expandedId === s.sessionId ? (
                  <ExpandedRow
                    detail={detail?.sessionId === s.sessionId ? detail : null}
                    loading={detailLoading}
                    error={detailError}
                  />
                ) : null}
              </div>
            ))}
          </div>
        )}
        {generatedAt ? (
          <div className="text-[10px] text-muted-foreground pt-2 border-t border-border/50">
            {t("opencode.sessions.generatedAt", { ts: formatRelative(generatedAt) })}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
