// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT

/**
 * Gemini native streaming regression: SSE framing must survive network chunk
 * boundaries that fall inside a CRLF pair (a chunk ending in a lone `\r`).
 * The previous hand-rolled `\n\n` frame scan stalled on such splits — frames
 * stayed glued in the buffer until later bytes completed a boundary, and the
 * final frame was lost entirely when the stream ended mid-terminator. The
 * WHATWG decoder ported from deepseek chat-demo sse.ts fixes this, so the
 * sweep below asserts the full delta sequence for every 2-way split.
 */

import { afterEach, describe, expect, it, vi } from "vitest"
import type { ChatChunk, ChatMessage } from "../src/base.js"
import { GeminiNativeProvider } from "../src/formats/gemini-native.js"

const MESSAGES: ChatMessage[] = [{ role: "user", content: "hi" }]

function makeProvider(): GeminiNativeProvider {
  return new GeminiNativeProvider({
    id: "gemini-test",
    name: "Gemini Test",
    apiKey: "test-key",
    baseURL: "https://gemini.example.test",
    defaultModel: "gemini-2.5-flash",
  })
}

/** One Gemini SSE frame: a single `data:` line with a CRLF terminator pair. */
function frame(text: string, finishReason?: string): string {
  const candidate: Record<string, unknown> = { content: { parts: [{ text }] } }
  if (finishReason) candidate.finishReason = finishReason
  return `data: ${JSON.stringify({ candidates: [candidate] })}\r\n\r\n`
}

/** Wire bytes for the frames, optionally ending with a lone CR. */
function wire(...frames: string[]): Uint8Array {
  return new TextEncoder().encode(frames.join(""))
}

function sseStream(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    },
  })
}

async function collectStream(chunks: Uint8Array[]): Promise<ChatChunk[]> {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(sseStream(chunks), { status: 200 })),
  )
  const provider = makeProvider()
  const out: ChatChunk[] = []
  for await (const chunk of provider.stream(MESSAGES)) {
    out.push(chunk)
  }
  return out
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("GeminiNativeProvider streaming (SSE framing regression)", () => {
  it("yields every delta and the terminal done chunk for every chunk split", async () => {
    const bytes = wire(frame("Hel"), frame("lo "), frame("world"), frame("!", "STOP"))
    const expected = [
      { delta: "Hel", done: false },
      { delta: "lo ", done: false },
      { delta: "world", done: false },
      { delta: "!", done: false },
      { delta: "", done: true },
    ]

    const oneShot = await collectStream([bytes])
    expect(oneShot.map((c) => ({ delta: c.delta, done: c.done }))).toEqual(expected)

    // Every possible 2-way network split — in particular splits that land
    // inside a CRLF terminator pair. The old scanner dropped the final
    // frame when the wire ended mid-terminator (split at length - 1).
    for (let k = 1; k < bytes.length; k++) {
      const events = await collectStream([bytes.slice(0, k), bytes.slice(k)])
      expect(
        events.map((c) => ({ delta: c.delta, done: c.done })),
        `2-way split at byte ${k}`,
      ).toEqual(expected)
    }
  })

  it("survives a CR-only wire and a final frame split across many chunks", async () => {
    // CR-only line endings plus the last frame fed one byte at a time.
    const bytes = wire(frame("a"), frame("b"))
    const expected = [
      { delta: "a", done: false },
      { delta: "b", done: false },
      { delta: "", done: true },
    ]
    const single = await collectStream(Array.from(bytes, (b) => new Uint8Array([b])))
    expect(single.map((c) => ({ delta: c.delta, done: c.done }))).toEqual(expected)
  })

  it("keeps streaming after a malformed JSON frame", async () => {
    const bytes = wire(frame("before"), "data: not-json\r\n\r\n", frame("after"))
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(sseStream([bytes]), { status: 200 })),
    )
    const provider = makeProvider()
    const deltas: string[] = []
    for await (const chunk of provider.stream(MESSAGES)) {
      if (chunk.done) break
      deltas.push(chunk.delta)
    }
    expect(deltas).toEqual(["before", "after"])
  })

  it("attaches the parsed GeminiResponse as raw (finishReason inside)", async () => {
    const bytes = wire(frame("hi", "STOP"))
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(sseStream([bytes]), { status: 200 })),
    )
    const provider = makeProvider()
    const chunks: ChatChunk[] = []
    for await (const chunk of provider.stream(MESSAGES)) {
      chunks.push(chunk)
    }
    // The stream path passes the payload through `raw` verbatim; mapping
    // finishReason onto the chunk is left to the retry/watchdog layers.
    const last = chunks.at(-2)
    expect(last?.delta).toBe("hi")
    expect(last?.raw).toMatchObject({ candidates: [{ finishReason: "STOP" }] })
    expect(chunks.at(-1)?.done).toBe(true)
  })
})
