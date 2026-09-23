// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Data hook for the session-query domain: GET /sessions/search via the
 * dashboard's fetchJson chokepoint (arch-boundary: no direct fetch here)
 * with a react-query cache keyed on the trimmed query + workspace scope.
 * Disabled for empty queries so a cleared input does not fire requests.
 */

import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { z } from "zod"
import { authHeaders, BASE, fetchJson } from "@/api"

const SearchResponseSchema = z.object({
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
})

export type SessionSearchResponse = z.infer<typeof SearchResponseSchema>

export function useSessionSearch(query: string, workspaceId?: string) {
  const q = query.trim()
  return useQuery({
    queryKey: ["session-search", q, workspaceId ?? null],
    enabled: q.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ q })
      if (workspaceId) params.set("workspaceId", workspaceId)
      return fetchJson(
        `${BASE}/sessions/search?${params.toString()}`,
        { headers: authHeaders(), signal },
        SearchResponseSchema,
      )
    },
  })
}
