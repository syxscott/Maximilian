/**
 * SSE replay buffer tests — exercises the per-workspace ring buffer
 * and `Last-Event-ID` parsing semantics.
 *
 * The browser's `EventSource` automatically tracks the latest `id:` it
 * has seen and sends it back as `Last-Event-ID` on reconnect. Our buffer
 * needs to:
 *   - assign monotonic ids per workspace
 *   - return events with `id > lastEventId`
 *   - evict old entries beyond capacity (without resetting the id counter)
 *   - encode wire frames with both `id:` and `data:` lines
 */

import { describe, it, expect } from "vitest"
import { SseReplayBuffer, parseLastEventId, encodeSseFrame } from "../src/lib/sse-replay"

describe("SseReplayBuffer", () => {
  it("assigns monotonic ids per workspace", () => {
    const buf = new SseReplayBuffer(10)
    const a1 = buf.append("ws-1", { type: "workspace" })
    const a2 = buf.append("ws-1", { type: "event" })
    const b1 = buf.append("ws-2", { type: "workspace" })

    // IDs are seeded from Date.now() so they don't start at 1 (see #626:
    // restart must not rewind IDs or clients miss events). What matters
    // is monotonicity within a workspace and separate counters per ws.
    expect(a2.id).toBe(a1.id + 1)
    expect(b1.id).not.toBe(a1.id) // separate counter per workspace
  })

  it("since() returns only events with id > lastEventId", () => {
    const buf = new SseReplayBuffer(10)
    const e1 = buf.append("ws-1", { n: 1 })
    buf.append("ws-1", { n: 2 })
    buf.append("ws-1", { n: 3 })

    const replay = buf.since("ws-1", e1.id)
    expect(replay.length).toBe(2)
    expect(replay[0]!.data).toEqual({ n: 2 })
    expect(replay[1]!.data).toEqual({ n: 3 })
  })

  it("since() returns everything when lastEventId is 0", () => {
    const buf = new SseReplayBuffer(10)
    buf.append("ws-1", { n: 1 })
    buf.append("ws-1", { n: 2 })

    const replay = buf.since("ws-1", 0)
    expect(replay.length).toBe(2)
  })

  it("since() returns empty for unknown workspace", () => {
    const buf = new SseReplayBuffer(10)
    expect(buf.since("ws-unknown", 0)).toEqual([])
  })

  it("evicts oldest entries beyond capacity but keeps id counter monotonic", () => {
    const buf = new SseReplayBuffer(2)
    const e1 = buf.append("ws-1", { n: 1 })
    const e2 = buf.append("ws-1", { n: 2 })
    const e3 = buf.append("ws-1", { n: 3 })

    // Buffer holds only the last 2, but ids continue past capacity.
    const replay = buf.since("ws-1", 0)
    expect(replay.length).toBe(2)
    expect(replay[0]!.data).toEqual({ n: 2 })
    expect(replay[0]!.id).toBe(e2.id)
    expect(replay[1]!.data).toEqual({ n: 3 })
    expect(replay[1]!.id).toBe(e3.id)

    // Client that saw id=e2 and reconnects should get only e3.
    const after2 = buf.since("ws-1", e2.id)
    expect(after2.length).toBe(1)
    expect(after2[0]!.id).toBe(e3.id)
  })

  it("size() returns total buffered across all workspaces", () => {
    const buf = new SseReplayBuffer(10)
    buf.append("ws-1", { n: 1 })
    buf.append("ws-1", { n: 2 })
    buf.append("ws-2", { n: 1 })
    expect(buf.size()).toBe(3)
  })

  it("clear() drops everything for a workspace", () => {
    const buf = new SseReplayBuffer(10)
    buf.append("ws-1", { n: 1 })
    buf.clear("ws-1")
    expect(buf.since("ws-1", 0)).toEqual([])
  })
})

describe("parseLastEventId", () => {
  it("returns 0 for missing header", () => {
    expect(parseLastEventId(undefined)).toBe(0)
    expect(parseLastEventId(null)).toBe(0)
    expect(parseLastEventId("")).toBe(0)
  })

  it("parses a numeric id", () => {
    expect(parseLastEventId("42")).toBe(42)
  })

  it("returns 0 for non-numeric input", () => {
    expect(parseLastEventId("not-a-number")).toBe(0)
  })

  it("returns 0 for negative numbers", () => {
    expect(parseLastEventId("-1")).toBe(0)
  })
})

describe("encodeSseFrame", () => {
  it("produces a frame with id: and data: lines", () => {
    const buf = new SseReplayBuffer(10)
    const event = buf.append("ws-1", { type: "event", value: 42 })
    const frame = encodeSseFrame(event)
    expect(frame).toContain(`id: ${event.id}\n`)
    expect(frame).toContain('data: {"type":"event","value":42}\n')
    expect(frame.endsWith("\n\n")).toBe(true)
  })
})
