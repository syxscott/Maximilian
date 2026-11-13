// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Session-tree + backup/restore API client (deepseek chat-demo borrowing
 * for the message-tree contract).
 *
 * Deliberately separate from `api.ts` (owned by another workstream during
 * parallel work): this module covers the pinned session-tree contract —
 * `parentId` / `selectedChildId` on message rows, the sibling-version
 * select endpoint — and the backup/restore archive endpoints, which move
 * Blobs/multipart bodies that `fetchJson`'s JSON pipeline does not shape.
 * Shared plumbing (`BASE`, `authHeaders`, `fetchJson`, zod) is imported
 * from `api.ts` so auth headers and error shaping stay in one place.
 */

import { authHeaders, BASE, fetchJson, z } from "./api"

/**
 * One message row of a session. Tree fields are optional + nullable so an
 * older backend without the columns still validates (legacy rows are all
 * null — a fully linear session).
 */
export const SessionMessageRowSchema = z.object({
  id: z.string(),
  role: z.string(),
  content: z.string(),
  createdAt: z.string().nullable(),
  parentId: z.string().nullable().optional(),
  selectedChildId: z.string().nullable().optional(),
})

export type SessionMessageRow = z.infer<typeof SessionMessageRowSchema>

const SessionMessagesSchema = z.object({
  sessionId: z.string(),
  messages: z.array(SessionMessageRowSchema),
})

const SelectVersionSchema = z.object({ ok: z.boolean() })

const RestoreResultSchema = z.object({ restored: z.number() })

/** Backup archive plus the download filename the server suggested. */
export interface SessionBackupDownload {
  blob: Blob
  /** From Content-Disposition; null when the server sent none. */
  filename: string | null
}

/**
 * Parse a Content-Disposition attachment filename — RFC 5987
 * `filename*=UTF-8''...` first, then the plain quoted/unquoted form.
 */
function filenameFromDisposition(header: string | null): string | null {
  if (!header) return null
  const extended = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(header)
  if (extended?.[1]) {
    try {
      const decoded = decodeURIComponent(extended[1].trim().replace(/^"|"$/g, ""))
      if (decoded) return decoded
    } catch {
      // Malformed pct-encoding — fall through to the plain form.
    }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/.exec(header)
  const name = plain?.[1]?.trim()
  return name && name.length > 0 ? name : null
}

export const sessionsTreeApi = {
  /** Messages of one session, including the message-tree fields. */
  getSessionMessages: (id: string, signal?: AbortSignal) =>
    fetchJson(
      `${BASE}/sessions/${encodeURIComponent(id)}/messages`,
      { headers: authHeaders(), signal },
      SessionMessagesSchema,
    ),

  /** Select a sibling version as the message's current branch (server-side). */
  selectMessageVersion: (sessionId: string, messageId: string): Promise<{ ok: boolean }> =>
    fetchJson(
      `${BASE}/sessions/${encodeURIComponent(sessionId)}/messages/${encodeURIComponent(messageId)}/select`,
      { method: "POST", headers: authHeaders() },
      SelectVersionSchema,
    ),

  /**
   * Download the sessions backup archive (application/zip attachment).
   * Returns the Blob for the caller's `a[download]` trigger plus the
   * server-suggested filename (null → caller generates one).
   */
  backupSessions: async (): Promise<SessionBackupDownload> => {
    const res = await fetch(`${BASE}/sessions/backup`, { headers: authHeaders() })
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      const detail = body ? `: ${body.slice(0, 200)}` : ""
      throw new Error(`${res.status} ${res.statusText}${detail}`)
    }
    const blob = await res.blob()
    return { blob, filename: filenameFromDisposition(res.headers.get("Content-Disposition")) }
  },

  /**
   * Upload a backup archive and replace every session with its contents.
   * Errors (400 included) surface as plain Errors whose message carries the
   * server's reason text via fetchJson's status + body prefix.
   */
  restoreSessions: (file: File): Promise<{ restored: number }> => {
    const body = new FormData()
    body.append("file", file)
    return fetchJson(
      `${BASE}/sessions/restore`,
      { method: "POST", headers: authHeaders(), body },
      RestoreResultSchema,
    )
  },
}
