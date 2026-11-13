// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * SessionsPanel — conversation history browser (the read side of the
 * SQLite double-write; ZCode session list / opencode home-session
 * borrowing). Lists persisted sessions (newest first, scoped to the
 * selected workspace when one is active); expanding a session loads its
 * user/assistant messages inline.
 *
 * deepseek chat-demo borrowing, three consumer surfaces:
 *   - time grouping (sessionGroups): the list renders under
 *     今天/昨天/7 天内/30 天内/按月 section headers, `sessions.group.*`
 *     i18n keys resolved through the dashboard locale files;
 *   - message-tree version switching (branches.buildMessageVersions): an
 *     expanded session renders a `<n/m>` sibling switcher on every message
 *     that has sibling versions; a click POSTs the select endpoint and
 *     refetches. Linear sessions (every row unparented) yield singleton
 *     groups, so no switcher renders for them;
 *   - backup/restore: the header exports the whole session store as a zip
 *     (server Content-Disposition filename, local fallback) and imports an
 *     archive after an explicit confirm — the import REPLACES all sessions.
 */

import { useMemo, useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useLocale, t, formatRelative } from "@max/i18n"
import { buildMessageVersions, groupSessions, type MessageVersions } from "@max/ui-react"
import { sessionsApi } from "@/api"
import { sessionsTreeApi } from "@/api-sessions"
import { queryKeys } from "@/lib/api/hooks"
import { useNotificationStore } from "@/stores/notificationStore"
import { SkeletonBlock, EmptyHint } from "@/components/ai-elements"

/** Error message for notifications — server reasons ride along verbatim. */
function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function SessionsPanel({ workspaceId }: { workspaceId?: string }) {
  useLocale()
  const [openId, setOpenId] = useState<string | null>(null)
  const queryClient = useQueryClient()
  const notify = useNotificationStore((s) => s.push)
  const [backupBusy, setBackupBusy] = useState(false)
  const [restoreBusy, setRestoreBusy] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { data, isLoading } = useQuery({
    queryKey: [...queryKeys.sessions, workspaceId ?? "all"],
    queryFn: ({ signal }) => sessionsApi.list({ workspaceId, limit: 30 }, signal),
    staleTime: 30_000,
  })

  const sessions = data?.sessions ?? []
  // Time buckets (deepseek chat-demo borrowing): the API returns the list
  // newest-first, exactly the order groupSessions preserves.
  const groups = useMemo(() => groupSessions(sessions, Date.now()), [sessions])

  /** Download the backup archive and hand it to the browser's save flow. */
  const onBackup = async () => {
    setBackupBusy(true)
    try {
      const { blob, filename } = await sessionsTreeApi.backupSessions()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download =
        filename ?? `maximilian-sessions-${new Date().toISOString().slice(0, 10)}.zip`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
      notify("success", "sessions.notify.backupDone")
    } catch (err) {
      notify("error", "sessions.notify.backupFailed", { message: describeError(err) })
    } finally {
      setBackupBusy(false)
    }
  }

  /** Import an archive — chat-demo semantics: it REPLACES all sessions. */
  const onRestoreFile = async (file: File) => {
    if (!window.confirm(t("sessions.restore.confirm"))) return
    setRestoreBusy(true)
    try {
      const { restored } = await sessionsTreeApi.restoreSessions(file)
      await queryClient.invalidateQueries({ queryKey: queryKeys.sessions })
      notify("success", "sessions.notify.restoreDone", { count: String(restored) })
    } catch (err) {
      // A 400's reason text is part of the error message (fetchJson keeps
      // the response body prefix) — surface it instead of a bare failure.
      notify("error", "sessions.notify.restoreFailed", { message: describeError(err) })
    } finally {
      setRestoreBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">
          {t("sessions.title")}
          <span className="ml-2 text-xs text-muted-foreground">{sessions.length}</span>
        </CardTitle>
        {/* Backup/restore (deepseek chat-demo borrowing): export downloads
            the server-side zip; import replaces every session after an
            explicit confirm. The file input stays hidden — the button
            drives it so keyboard focus stays on a real button. */}
        <div className="mt-1 flex gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => void onBackup()}
            disabled={backupBusy || restoreBusy}
            data-testid="sessions-backup"
          >
            {backupBusy ? t("sessions.exporting") : t("sessions.export")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => fileInputRef.current?.click()}
            disabled={backupBusy || restoreBusy}
            data-testid="sessions-restore"
          >
            {restoreBusy ? t("sessions.importing") : t("sessions.import")}
          </Button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".zip,application/zip"
          className="hidden"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ""
            if (file) void onRestoreFile(file)
          }}
        />
      </CardHeader>
      <CardContent>
        {isLoading ? (
          // Loading state: three shimmering skeleton lines instead of a
          // bare text row (SkeletonBlock carries its own role="status").
          <div data-testid="sessions-skeleton">
            <SkeletonBlock shape={{ variant: "text", lines: 3 }} />
          </div>
        ) : sessions.length === 0 ? (
          // Empty state through the shared EmptyHint placeholder — the
          // same icon + copy style the timeline and deliverables use.
          <div data-testid="sessions-empty">
            <EmptyHint hint={{ title: t("sessions.empty") }} />
          </div>
        ) : (
          <div className="space-y-3" data-testid="sessions-list">
            {groups.map((group) => (
              <section key={group.key}>
                <h3 className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {group.labelKey ? t(group.labelKey) : group.label || t("sessions.group.earlier")}
                </h3>
                <ul className="space-y-1">
                  {group.items.map((session) => {
                    const open = openId === session.id
                    return (
                      <li key={session.id} className="rounded-md border">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-auto w-full flex-col items-start gap-0.5 py-1.5 text-left"
                          onClick={() => setOpenId(open ? null : session.id)}
                          aria-expanded={open}
                        >
                          <span className="w-full truncate text-xs font-medium">
                            {session.title ?? session.id}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            {session.workspaceId ?? "—"}
                            {session.updatedAt ? ` · ${formatRelative(session.updatedAt)}` : ""}
                          </span>
                        </Button>
                        {open && <SessionMessages sessionId={session.id} />}
                      </li>
                    )
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * `<n/m>` sibling-version switcher (deepseek chat-demo borrowing): prev/
 * next buttons walk the sibling group buildMessageVersions produced; the
 * current index renders between them. Singleton groups render nothing —
 * that is what keeps linear sessions free of controls.
 */
function MessageVersionSwitcher({
  version,
  disabled,
  onSelect,
}: {
  version: MessageVersions | null
  disabled: boolean
  onSelect: (messageId: string) => void
}) {
  if (!version || version.ids.length <= 1) return null
  const step = (delta: 1 | -1) => {
    const at = (version.index + delta + version.ids.length) % version.ids.length
    const next = version.ids[at]
    if (next) onSelect(next)
  }
  return (
    <span className="ml-auto inline-flex items-center gap-0.5" data-testid="message-versions">
      <button
        type="button"
        className="h-4 w-4 rounded border border-border text-[10px] leading-none text-muted-foreground hover:bg-muted"
        aria-label={t("sessions.versions.previous")}
        disabled={disabled}
        onClick={() => step(-1)}
      >
        ‹
      </button>
      <span
        className="text-[10px] tabular-nums text-muted-foreground"
        data-testid="message-version-index"
      >
        {version.index + 1}/{version.ids.length}
      </span>
      <button
        type="button"
        className="h-4 w-4 rounded border border-border text-[10px] leading-none text-muted-foreground hover:bg-muted"
        aria-label={t("sessions.versions.next")}
        disabled={disabled}
        onClick={() => step(1)}
      >
        ›
      </button>
    </span>
  )
}

function SessionMessages({ sessionId }: { sessionId: string }) {
  useLocale()
  const notify = useNotificationStore((s) => s.push)
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: queryKeys.sessionMessages(sessionId),
    queryFn: ({ signal }) => sessionsTreeApi.getSessionMessages(sessionId, signal),
    staleTime: 60_000,
  })

  const messages = useMemo(() => data?.messages ?? [], [data])
  // Sibling-version index (deepseek chat-demo borrowing): legacy linear
  // rows (all parentId null) group singletons, so a linear session never
  // shows a switcher.
  const versions = useMemo(() => buildMessageVersions(messages), [messages])
  const [switchingId, setSwitchingId] = useState<string | null>(null)

  /** Pick a sibling version server-side, then refresh the message list. */
  const selectVersion = async (messageId: string) => {
    setSwitchingId(messageId)
    try {
      const res = await sessionsTreeApi.selectMessageVersion(sessionId, messageId)
      if (!res.ok) {
        notify("error", "sessions.notify.versionRejected")
        return
      }
      await refetch()
    } catch (err) {
      notify("error", "sessions.notify.versionSwitchFailed", { message: describeError(err) })
    } finally {
      setSwitchingId(null)
    }
  }

  if (isLoading)
    return <p className="px-2 pb-2 text-xs text-muted-foreground">{t("sessions.loading")}</p>
  if (error) return <p className="px-2 pb-2 text-xs text-destructive">{t("sessions.loadFailed")}</p>

  if (messages.length === 0) {
    return <p className="px-2 pb-2 text-xs text-muted-foreground">{t("sessions.noMessages")}</p>
  }

  return (
    <div className="space-y-1.5 px-2 pb-2" data-testid="session-messages">
      {messages.map((m) => (
        <div key={m.id} className="rounded border border-border/60 p-1.5">
          <div className="mb-1 flex items-center gap-1.5">
            <Badge
              variant={m.role === "user" ? "default" : "secondary"}
              className="h-4 px-1 text-[10px]"
            >
              {m.role}
            </Badge>
            <MessageVersionSwitcher
              version={versions.get(m.id) ?? null}
              disabled={switchingId !== null}
              onSelect={(id) => void selectVersion(id)}
            />
          </div>
          <p className="line-clamp-6 whitespace-pre-wrap break-words text-xs text-muted-foreground">
            {m.content}
          </p>
        </div>
      ))}
    </div>
  )
}
