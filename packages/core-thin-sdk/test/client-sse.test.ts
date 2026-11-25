// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT

/**
 * OpencodeHttpClient SSE regression: the `\n\n` frame scan must be linear in
 * the buffered text. The previous implementation rescanned the accumulated
 * buffer from index 0 and sliced the whole prefix for every chunk, which made
 * a large frame split across many chunks O(n²). These tests pin the envelope
 * sequence to the one-shot feed for fixed and pseudo-random chunkings.
 */

import { afterEach, describe, expect, it, vi } from "vitest"
import { OpencodeHttpClient } from "../src/client.js"
import type { EventEnvelope } from "../src/types.js"

const ENC = new TextEncoder()

function byteStream(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    },
  })
}

/** Frames carrying a monotonically increasing payload so order is observable. */
function wire(count: number, pad: number): string {
  let out = ""
  for (let i = 0; i < count; i++) {
    out += `id: ${i}\ndata: ${JSON.stringify({ type: "update", data: { n: i, pad: "x".repeat(pad) } })}\n\n`
  }
  return out
}

async function collect(chunks: Uint8Array[]): Promise<Array<{ id: string; type: string }>> {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(byteStream(chunks), { status: 200 })),
  )
  const client = new OpencodeHttpClient({ baseUrl: "http://opencode.test" })
  const out: Array<{ id: string; type: string }> = []
  for await (const event of client.stream<EventEnvelope<{ n: number; pad: string }>>("/event")) {
    out.push({ id: event.id, type: event.type })
  }
  return out
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("OpencodeHttpClient.parseSse — chunk invariance", () => {
  it("matches the one-shot sequence at several chunk sizes", async () => {
    const bytes = ENC.encode(wire(32, 2048)) // ~64 KiB
    const expected = await collect([bytes])
    expect(expected.length).toBe(32)

    for (const chunkSize of [1, 7, 512, 4096, bytes.length]) {
      const chunks: Uint8Array[] = []
      for (let start = 0; start < bytes.length; start += chunkSize) {
        chunks.push(bytes.slice(start, start + chunkSize))
      }
      const events = await collect(chunks)
      expect(events, `chunk size ${chunkSize}`).toEqual(expected)
    }
  })

  it("keeps a single large frame intact when it spans many chunks", async () => {
    const frame = `data: ${JSON.stringify({ type: "snapshot", data: { pad: "z".repeat(256 * 1024) } })}\n\n`
    const bytes = ENC.encode(frame)
    const chunkSize = 4096
    const chunks: Uint8Array[] = []
    for (let start = 0; start < bytes.length; start += chunkSize) {
      chunks.push(bytes.slice(start, start + chunkSize))
    }

    const events = await collect(chunks)
    expect(events).toEqual([{ id: "", type: "snapshot" }])
  })
})
