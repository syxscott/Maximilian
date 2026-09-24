// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Unit tests for POST /evolution/agents/{role}/memory-import (admin-status
 * route): strict zod validation of the imported bucket structure (400 on
 * drift, 404 on unknown role) and the write-back semantics over
 * facade.profiles — body buckets replace wholesale, absent buckets /
 * efficacy / archive are kept, totalEntries is recomputed. The route
 * definition itself is contract-guarded by test/api-contract.test.ts via
 * openapi-paths.json.
 */

import { describe, it, expect, vi } from "vitest"
import { memoryImportHandler } from "../src/routes/admin-status.js"

function makeFacade(profile: Record<string, unknown> | undefined) {
  return {
    profiles: {
      get: vi.fn(async () => profile),
      save: vi.fn(async () => undefined),
    },
  }
}

function makeContext(role: string | undefined, body: unknown) {
  return {
    req: {
      param: (key: string) => (key === "role" ? role : undefined),
      json: async () => body,
    },
    json: (payload: unknown, status?: number) => ({ payload, status: status ?? 200 }),
  } as never
}

const existingProfile = {
  role: "planner",
  currentVersion: "v2",
  manifest: { model: "test-model" },
  memory: {
    userFeedback: [{ mime: "text/plain", content: "old feedback" }],
    reviewSuggestions: [{ mime: "text/plain", content: "old review" }],
    commonErrors: [],
    goodExamples: [],
    efficacy: { userFeedback: { injectedCount: 4, deltaSum: 1 } },
    archived: { commonErrors: [{ mime: "text/plain", content: "quarantined" }] },
    totalEntries: 2,
  },
}

const validBody = {
  buckets: {
    userFeedback: [
      { content: "prefer tables", mime: "text/plain" },
      { content: "be terse", mime: "text/plain", metadata: { at: "2026-09-24" } },
    ],
    commonErrors: [{ content: "forgot cleanup", mime: "text/plain" }],
  },
  efficacy: { userFeedback: { injectedCount: 2, deltaSum: -0.5 } },
}

describe("POST /evolution/agents/{role}/memory-import", () => {
  it("writes the imported buckets back through facade.profiles.save", async () => {
    const facade = makeFacade(existingProfile)
    const handler = memoryImportHandler({ facade: facade as never })

    const res = (await handler(makeContext("planner", validBody))) as {
      status: number
      payload: Record<string, unknown>
    }

    expect(res.status).toBe(200)
    expect(res.payload.ok).toBe(true)
    expect(res.payload.role).toBe("planner")
    expect(res.payload.imported).toEqual({
      userFeedback: 2,
      reviewSuggestions: 0,
      commonErrors: 1,
      goodExamples: 0,
    })
    expect(res.payload.totalEntries).toBe(4) // 2 imported + 1 kept bucket entry

    expect(facade.profiles.save).toHaveBeenCalledTimes(1)
    const saved = (facade.profiles.save.mock.calls[0]?.[0] ?? {}) as {
      role: string
      memory: Record<string, unknown>
    }
    expect(saved.role).toBe("planner")
    // Manifest and other profile fields ride along untouched.
    expect((saved as { manifest?: unknown }).manifest).toEqual({ model: "test-model" })
    expect(saved.memory.userFeedback).toEqual([
      { content: "prefer tables", mime: "text/plain" },
      { content: "be terse", mime: "text/plain", metadata: { at: "2026-09-24" } },
    ])
    expect(saved.memory.commonErrors).toEqual([{ content: "forgot cleanup", mime: "text/plain" }])
    // Restored ledger + recomputed entry count.
    expect(saved.memory.efficacy).toEqual({ userFeedback: { injectedCount: 2, deltaSum: -0.5 } })
    expect(saved.memory.totalEntries).toBe(4) // 3 sent + 1 kept reviewSuggestions entry
  })

  it("keeps buckets, ledger and archive that the body leaves out", async () => {
    const facade = makeFacade(existingProfile)
    const handler = memoryImportHandler({ facade: facade as never })

    await handler(
      makeContext("planner", {
        buckets: { commonErrors: [{ content: "new error", mime: "text/plain" }] },
      }),
    )

    const saved = (facade.profiles.save.mock.calls[0]?.[0] ?? {}) as {
      memory: Record<string, unknown>
    }
    expect(saved.memory.userFeedback).toEqual([{ mime: "text/plain", content: "old feedback" }])
    expect(saved.memory.reviewSuggestions).toEqual([{ mime: "text/plain", content: "old review" }])
    expect(saved.memory.commonErrors).toEqual([{ content: "new error", mime: "text/plain" }])
    expect(saved.memory.efficacy).toEqual({ userFeedback: { injectedCount: 4, deltaSum: 1 } })
    expect(saved.memory.archived).toEqual({
      commonErrors: [{ mime: "text/plain", content: "quarantined" }],
    })
    expect(saved.memory.totalEntries).toBe(3) // 1 imported + 2 kept bucket entries
  })

  it("answers 404 when the role has no profile", async () => {
    const facade = makeFacade(undefined)
    const handler = memoryImportHandler({ facade: facade as never })
    const res = (await handler(makeContext("ghost", validBody))) as {
      status: number
      payload: { error: string }
    }
    expect(res.status).toBe(404)
    expect(res.payload.error).toContain("not found")
    expect(facade.profiles.save).not.toHaveBeenCalled()
  })

  it("answers 400 with a path-aware message for invalid structures", async () => {
    const facade = makeFacade(existingProfile)
    const handler = memoryImportHandler({ facade: facade as never })

    const badBodies: Array<Record<string, unknown>> = [
      // Entry without the required content field.
      { buckets: { userFeedback: [{ mime: "text/plain" }] } },
      // Entry without the required mime field.
      { buckets: { userFeedback: [{ content: "x" }] } },
      // Empty-string content (needs at least one character).
      { buckets: { userFeedback: [{ content: "", mime: "text/plain" }] } },
      // Unknown extra bucket key.
      { buckets: { secrets: [{ content: "x", mime: "text/plain" }] } },
      // Bucket that is not an array.
      { buckets: { userFeedback: "nope" } },
      // No entries at all.
      { buckets: { userFeedback: [] } },
      // Malformed efficacy ledger.
      { buckets: validBody.buckets, efficacy: { userFeedback: { injectedCount: -1 } } },
    ]
    for (const body of badBodies) {
      const res = (await handler(makeContext("planner", body))) as {
        status: number
        payload: { error: string }
      }
      expect(res.status, JSON.stringify(body)).toBe(400)
      expect(res.payload.error).toContain("Invalid memory import")
    }
    expect(facade.profiles.save).not.toHaveBeenCalled()
  })

  it("answers 400 for a body that is not JSON at all", async () => {
    const facade = makeFacade(existingProfile)
    const handler = memoryImportHandler({ facade: facade as never })
    const ctx = {
      req: {
        param: () => "planner",
        json: async () => {
          throw new Error("unexpected end of body")
        },
      },
      json: (payload: unknown, status?: number) => ({ payload, status: status ?? 200 }),
    } as never
    const res = (await handler(ctx)) as { status: number; payload: { error: string } }
    expect(res.status).toBe(400)
    expect(res.payload.error).toContain("JSON")
  })
})
