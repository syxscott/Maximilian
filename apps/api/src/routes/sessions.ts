// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Session-history routes — read-only views over the SQLite session store
 * (mcode double-write borrowing, read side). The store is populated by
 * the runtime double-write; these endpoints expose it to the dashboard's
 * history browser. 503 when SESSION_STORE_ENABLED is off (no side store
 * in this process).
 */

import { createRoute } from "@hono/zod-openapi"
import type { Context } from "hono"
import { z } from "zod"
import type { SessionStore } from "@max/session-store"
import { ErrorSchema } from "../schemas.js"

export interface SessionRouteDeps {
  store?: SessionStore
}

const listSessionsRoute = createRoute({
  method: "get",
  path: "/sessions",
  tags: ["sessions"],
  request: {
    query: z.object({
      workspaceId: z.string().optional(),
      limit: z.coerce.number().int().positive().max(500).optional(),
    }),
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            sessions: z.array(
              z.object({
                id: z.string(),
                workspaceId: z.string().nullable(),
                title: z.string().nullable(),
                createdAt: z.string().nullable(),
                updatedAt: z.string().nullable(),
              }),
            ),
          }),
        },
      },
      description: "Persisted sessions, newest first",
    },
    503: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Session store disabled",
    },
  },
})

const getMessagesRoute = createRoute({
  method: "get",
  path: "/sessions/{id}/messages",
  tags: ["sessions"],
  request: {
    params: z.object({ id: z.string().min(1) }),
    query: z.object({ limit: z.coerce.number().int().positive().max(2000).optional() }),
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            sessionId: z.string(),
            messages: z.array(
              z.object({
                id: z.string(),
                role: z.string(),
                content: z.string(),
                createdAt: z.string().nullable(),
              }),
            ),
          }),
        },
      },
      description: "Conversation messages for a session",
    },
    404: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Unknown session",
    },
    503: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Session store disabled",
    },
  },
})

const searchMessagesRoute = createRoute({
  method: "get",
  path: "/sessions/search",
  tags: ["sessions"],
  request: {
    query: z.object({
      q: z.string().min(1).max(200),
      workspaceId: z.string().optional(),
      limit: z.coerce.number().int().positive().max(500).optional(),
    }),
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            query: z.string(),
            results: z.array(
              z.object({
                sessionId: z.string(),
                workspaceId: z.string().nullable(),
                role: z.string(),
                content: z.string(),
                createdAt: z.string().nullable(),
              }),
            ),
          }),
        },
      },
      description: "Cross-session message search hits, newest first (literal substring match)",
    },
    503: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Session store disabled",
    },
  },
})

const getTimelineRoute = createRoute({
  method: "get",
  path: "/sessions/{id}/timeline",
  tags: ["sessions"],
  request: {
    params: z.object({ id: z.string().min(1) }),
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            sessionId: z.string(),
            turns: z.array(
              z.object({
                id: z.string(),
                role: z.string(),
                turnOrdinal: z.number().nullable(),
                createdAt: z.string(),
                deleted: z.boolean(),
              }),
            ),
          }),
        },
      },
      description: "Turn-level timeline (rewind-capable, hermes state_rewind borrowing)",
    },
    503: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Session store disabled",
    },
  },
})

export function sessionRoutes(deps: SessionRouteDeps) {
  const requireStore = (c: Context): SessionStore | undefined => {
    if (!deps.store) {
      c.json(
        { error: "session store disabled (SESSION_STORE_ENABLED=false or store failed to open)" },
        503,
      )
      return undefined
    }
    return deps.store
  }

  return {
    listSessions: async (c: Context) => {
      const store = requireStore(c)
      if (!store) return
      const q = c.req.valid("query" as never) as { workspaceId?: string; limit?: number }
      const sessions = store.listSessions(q.workspaceId, q.limit ?? 100)
      return c.json({ sessions })
    },

    getMessages: async (c: Context) => {
      const store = requireStore(c)
      if (!store) return
      const { id } = c.req.valid("param" as never) as { id: string }
      const q = c.req.valid("query" as never) as { limit?: number }
      const session = store.getSession(id)
      if (!session) return c.json({ error: "unknown session" }, 404)
      const messages = store.listMessages(id, q.limit ?? 500).map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt,
      }))
      return c.json({ sessionId: id, messages })
    },

    searchMessages: async (c: Context) => {
      const store = requireStore(c)
      if (!store) return
      const q = c.req.valid("query" as never) as {
        q: string
        workspaceId?: string
        limit?: number
      }
      const results = store.searchMessages(q.q, {
        limit: q.limit ?? 50,
        workspaceId: q.workspaceId,
      })
      return c.json({ query: q.q, results })
    },

    getTimeline: async (c: Context) => {
      const store = requireStore(c)
      if (!store) return
      const { id } = c.req.valid("param" as never) as { id: string }
      const turns = store.timeline(id).map((t) => ({
        id: t.id,
        role: t.role,
        turnOrdinal: t.turnOrdinal ?? null,
        createdAt: t.createdAt,
        deleted: Boolean(t.deleted),
      }))
      return c.json({ sessionId: id, turns })
    },
  }
}

export { listSessionsRoute, getMessagesRoute, searchMessagesRoute, getTimelineRoute }
