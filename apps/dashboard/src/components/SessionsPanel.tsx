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
 */

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useLocale, t, formatRelative } from "@max/i18n"
import { sessionsApi } from "@/api"
import { queryKeys } from "@/lib/api/hooks"
import { SkeletonBlock } from "@/components/ai-elements"

export function SessionsPanel({ workspaceId }: { workspaceId?: string }) {
  useLocale()
  const [openId, setOpenId] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: [...queryKeys.sessions, workspaceId ?? "all"],
    queryFn: ({ signal }) => sessionsApi.list({ workspaceId, limit: 30 }, signal),
    staleTime: 30_000,
  })

  const sessions = data?.sessions ?? []

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">
          {t("sessions.title")}
          <span className="ml-2 text-xs text-muted-foreground">{sessions.length}</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          // Loading state: three shimmering skeleton lines instead of a
          // bare text row (SkeletonBlock carries its own role="status").
          <div data-testid="sessions-skeleton">
            <SkeletonBlock shape={{ variant: "text", lines: 3 }} />
          </div>
        ) : sessions.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("sessions.empty")}</p>
        ) : (
          <ul className="space-y-1" data-testid="sessions-list">
            {sessions.map((session) => {
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
        )}
      </CardContent>
    </Card>
  )
}

function SessionMessages({ sessionId }: { sessionId: string }) {
  useLocale()
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.sessionMessages(sessionId),
    queryFn: ({ signal }) => sessionsApi.messages(sessionId, signal),
    staleTime: 60_000,
  })

  if (isLoading)
    return <p className="px-2 pb-2 text-xs text-muted-foreground">{t("sessions.loading")}</p>
  if (error) return <p className="px-2 pb-2 text-xs text-destructive">{t("sessions.loadFailed")}</p>

  const messages = data?.messages ?? []
  if (messages.length === 0) {
    return <p className="px-2 pb-2 text-xs text-muted-foreground">{t("sessions.noMessages")}</p>
  }

  return (
    <div className="space-y-1.5 px-2 pb-2" data-testid="session-messages">
      {messages.map((m) => (
        <div key={m.id} className="rounded border border-border/60 p-1.5">
          <Badge
            variant={m.role === "user" ? "default" : "secondary"}
            className="mb-1 h-4 px-1 text-[10px]"
          >
            {m.role}
          </Badge>
          <p className="line-clamp-6 whitespace-pre-wrap break-words text-xs text-muted-foreground">
            {m.content}
          </p>
        </div>
      ))}
    </div>
  )
}
