import { describe, it, expect } from "vitest"
import { createFlagsClient } from "../src/feature-flags.js"

describe("FlagsClient", () => {
  it("caches values within TTL", async () => {
    let calls = 0
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      calls++
      if (init?.method === "POST") {
        return new Response(JSON.stringify({ values: { META_AGENT_ENABLED: true } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      }
      return new Response(
        JSON.stringify({
          name: "META_AGENT_ENABLED",
          enabled: true,
          defaultValue: true,
          description: "test",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )
    }) as typeof fetch

    try {
      const client = createFlagsClient({
        baseUrl: "https://example.test",
        cacheTtlMs: 60_000,
      })

      const a = await client.isEnabled("META_AGENT_ENABLED")
      const b = await client.isEnabled("META_AGENT_ENABLED")
      const c = await client.isEnabled("META_AGENT_ENABLED")

      expect(a).toBe(true)
      expect(b).toBe(true)
      expect(c).toBe(true)
      expect(calls).toBe(1) // cache hit on 2nd + 3rd call
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it("returns false for unknown flag without throwing", async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ error: "not found" }), { status: 404 })
    }) as typeof fetch

    try {
      const client = createFlagsClient({
        baseUrl: "https://example.test",
        cacheTtlMs: 0,
      })
      const v = await client.isEnabled("MISSING_FLAG")
      expect(v).toBe(false)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})