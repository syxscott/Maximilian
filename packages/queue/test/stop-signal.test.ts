// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Tests for the cross-process workspace stop signal.
 *
 * Static checks (always run): payload encode/decode round-trip, defensive
 * decoding of tampered input, channel constant stability.
 * Live check (skips without REDIS_URL): publish → subscribe delivery.
 */
import { describe, it, expect } from "vitest"
import {
  WORKSPACE_STOP_CHANNEL,
  encodeStopSignal,
  decodeStopSignal,
  publishWorkspaceStop,
  subscribeWorkspaceStop,
} from "../src/stop-signal.js"

describe("stop signal payload", () => {
  it("channel has the canonical namespaced name", () => {
    expect(WORKSPACE_STOP_CHANNEL).toBe("maximilian:workspace:stop")
  })

  it("round-trips a full signal", () => {
    const signal = { workspaceId: "ws-1", reason: "user stop", source: "api" }
    expect(decodeStopSignal(encodeStopSignal(signal))).toEqual(signal)
  })

  it("omits optional fields when absent", () => {
    const decoded = decodeStopSignal(encodeStopSignal({ workspaceId: "ws-2" }))
    expect(decoded).toEqual({ workspaceId: "ws-2" })
  })

  it("rejects garbage: non-JSON, non-object, empty/missing workspaceId", () => {
    expect(decodeStopSignal("not json")).toBeNull()
    expect(decodeStopSignal("42")).toBeNull()
    expect(decodeStopSignal(JSON.stringify({ reason: "x" }))).toBeNull()
    expect(decodeStopSignal(JSON.stringify({ workspaceId: "" }))).toBeNull()
    expect(decodeStopSignal(JSON.stringify({ workspaceId: 7 }))).toBeNull()
  })

  it("drops non-string reason/source instead of passing them through", () => {
    const decoded = decodeStopSignal(
      JSON.stringify({ workspaceId: "ws-3", reason: 1, source: true }),
    )
    expect(decoded).toEqual({ workspaceId: "ws-3" })
  })
})

// ── Live test (requires REDIS_URL) ──────────────────────────────────────────

const redisUrl = process.env.REDIS_URL
const d = redisUrl ? describe : describe.skip

d("live stop signal delivery (REDIS_URL set)", () => {
  it("delivers a published signal to the subscriber", async () => {
    expect(redisUrl).toBeTruthy()
    const received: unknown[] = []
    const unsubscribe = await subscribeWorkspaceStop(redisUrl!, (signal) => {
      received.push(signal)
    })
    try {
      // Subscription needs a beat to be registered server-side before publish.
      await new Promise((r) => setTimeout(r, 100))
      await publishWorkspaceStop(redisUrl!, { workspaceId: "ws-live-1", source: "test" })
      await new Promise((r) => setTimeout(r, 300))
      expect(received).toEqual([{ workspaceId: "ws-live-1", source: "test" }])
    } finally {
      await unsubscribe()
    }
  }, 10_000)
})
