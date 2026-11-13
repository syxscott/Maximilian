// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT

/**
 * WHATWG SSE decoder tests (deepseek chat-demo sse.ts borrowing).
 *
 * The core property is chunk-boundary invariance: feeding the same byte
 * stream in any split must yield exactly the one-shot event sequence. This
 * is the regression for the production bug where a network chunk ending in
 * a lone `\r` (a CRLF pair split at the chunk boundary) stalled a hand-rolled
 * `\n\n` frame scan, gluing consecutive frames together.
 *
 * Each differential sample also carries its spec-derived expected events, so
 * the harness proves correctness against the WHATWG algorithm and not merely
 * self-consistency across splits.
 */

import { describe, expect, it } from "vitest"
import {
  readServerSentEvents,
  ServerSentEventDecoder,
  type ServerSentEvent,
} from "../src/sse-decoder.js"

const ENC = new TextEncoder()

const SAMPLES: { name: string; wire: string; expected: ServerSentEvent[] }[] = [
  {
    name: "CRLF frames (Gemini style)",
    wire: 'data: {"n":1}\r\n\r\ndata: {"n":2}\r\n\r\n',
    expected: [
      { event: "message", data: '{"n":1}', lastEventId: "" },
      { event: "message", data: '{"n":2}', lastEventId: "" },
    ],
  },
  {
    name: "CR-only line endings",
    wire: "data: alpha\r\rdata: beta\r\r",
    expected: [
      { event: "message", data: "alpha", lastEventId: "" },
      { event: "message", data: "beta", lastEventId: "" },
    ],
  },
  {
    name: "mixed CRLF / LF / CR endings",
    wire: "data: a\r\nid: 1\r\n\rdata: b\n\rdata: c\n\n",
    expected: [
      { event: "message", data: "a", lastEventId: "1" },
      { event: "message", data: "b", lastEventId: "1" },
      { event: "message", data: "c", lastEventId: "1" },
    ],
  },
  {
    name: "comment and heartbeat lines",
    wire: ": keep-alive\r\n\r\n: ping\ndata: x\n\n",
    expected: [{ event: "message", data: "x", lastEventId: "" }],
  },
  {
    name: "multi-line data",
    wire: "data: line1\ndata: line2\n\n",
    expected: [{ event: "message", data: "line1\nline2", lastEventId: "" }],
  },
  {
    name: "BOM prefix",
    wire: "\uFEFFdata: bom\n\n",
    expected: [{ event: "message", data: "bom", lastEventId: "" }],
  },
  {
    name: "multi-byte UTF-8",
    wire: "data: こんにちは 世界 🌍\n\n",
    expected: [{ event: "message", data: "こんにちは 世界 🌍", lastEventId: "" }],
  },
  {
    name: "trailing CR at EOF counts as a line ending",
    wire: "data: done\n\r",
    expected: [{ event: "message", data: "done", lastEventId: "" }],
  },
  {
    name: "unterminated event without blank line is dropped",
    wire: "data: dangling",
    expected: [],
  },
  {
    name: "event / id / retry / unknown fields",
    wire: "event: custom\r\nid: 42\r\nretry: 100\r\nunknown: x\r\ndata: payload\r\n\r\n",
    expected: [{ event: "custom", data: "payload", lastEventId: "42" }],
  },
  {
    name: "id containing NUL is rejected",
    wire: "id: bad\u0000id\ndata: x\n\nid: good\ndata: y\n\n",
    expected: [
      { event: "message", data: "x", lastEventId: "" },
      { event: "message", data: "y", lastEventId: "good" },
    ],
  },
  {
    name: "empty stream",
    wire: "",
    expected: [],
  },
]

function byteStream(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    },
  })
}

async function collect(chunks: Uint8Array[]): Promise<ServerSentEvent[]> {
  const events: ServerSentEvent[] = []
  for await (const event of readServerSentEvents(byteStream(chunks))) {
    events.push(event)
  }
  return events
}

/** Deterministic xorshift32 so the pseudo-random splits are reproducible. */
function nextSeed(seed: number): number {
  let x = seed | 0
  x ^= x << 13
  x ^= x >>> 17
  x ^= x << 5
  return x | 0
}

/** Split into `segments` pieces at pseudo-random increasing boundaries. */
function splitRandom(bytes: Uint8Array, segments: number, seed: number): Uint8Array[] {
  const bounds = new Set<number>()
  let s = seed
  while (bounds.size < segments - 1) {
    s = nextSeed(s)
    const k = Math.abs(s) % bytes.length
    if (k > 0) bounds.add(k)
  }
  const sorted = [...bounds].sort((a, b) => a - b)
  const chunks: Uint8Array[] = []
  let start = 0
  for (const k of sorted) {
    chunks.push(bytes.slice(start, k))
    start = k
  }
  chunks.push(bytes.slice(start))
  return chunks
}

describe("SSE decoder — chunk-boundary invariance (differential)", () => {
  for (const sample of SAMPLES) {
    it(`every split of "${sample.name}" matches the one-shot sequence`, async () => {
      const bytes = ENC.encode(sample.wire)
      const expected = await collect([bytes])
      // Ground the one-shot reference in the spec-derived expectation first.
      expect(expected).toEqual(sample.expected)

      // Every possible 2-way split.
      for (let k = 1; k < bytes.length; k++) {
        const events = await collect([bytes.slice(0, k), bytes.slice(k)])
        expect(events, `2-way split at byte ${k}`).toEqual(expected)
      }

      // Byte-by-byte (n segments) — includes splits inside multi-byte
      // characters and inside every CRLF pair.
      const bytewise = await collect(Array.from(bytes, (b) => new Uint8Array([b])))
      expect(bytewise).toEqual(expected)

      // Pseudo-random multi-way splits.
      for (const [segments, seed] of [
        [3, 1],
        [5, 42],
        [8, 1337],
      ] as const) {
        if (bytes.length < segments) continue
        const events = await collect(splitRandom(bytes, segments, seed))
        expect(events, `${segments}-way random split (seed ${seed})`).toEqual(expected)
      }
    })
  }
})

describe("ServerSentEventDecoder", () => {
  it("rejects an id field containing NUL but accepts later valid ids", () => {
    const decoder = new ServerSentEventDecoder()
    expect(decoder.push("id: bad\u0000id\ndata: x\n\n")).toEqual([
      { event: "message", data: "x", lastEventId: "" },
    ])
    expect(decoder.push("id: good\ndata: y\n\n")).toEqual([
      { event: "message", data: "y", lastEventId: "good" },
    ])
  })

  it("ignores comment lines entirely (no events, no data pollution)", () => {
    const decoder = new ServerSentEventDecoder()
    expect(decoder.push(": ping\n\n")).toEqual([])
    expect(decoder.push(": keep\nalive\n")).toEqual([]) // colon-less "alive" is a field, not data
    expect(decoder.push("data: x\n\n")).toEqual([{ event: "message", data: "x", lastEventId: "" }])
  })

  it("joins multiple data lines with \\n", () => {
    const decoder = new ServerSentEventDecoder()
    expect(decoder.push("data: l1\ndata: l2\r\ndata: l3\n\n")).toEqual([
      { event: "message", data: "l1\nl2\nl3", lastEventId: "" },
    ])
  })

  it("strips exactly one optional space after the colon", () => {
    const decoder = new ServerSentEventDecoder()
    expect(decoder.push("data:no-space\n\n")).toEqual([
      { event: "message", data: "no-space", lastEventId: "" },
    ])
    expect(decoder.push("data:  two-spaces\n\n")).toEqual([
      { event: "message", data: " two-spaces", lastEventId: "" },
    ])
  })

  it("holds a trailing CR ambiguous between bare CR and CRLF half", () => {
    // Split "data: a\r\r\n" across pushes: the first \r ends the data line,
    // the second \r is an empty line whose terminator arrives one push later.
    // While the trailing \r is unresolved nothing may dispatch.
    const decoder = new ServerSentEventDecoder()
    expect(decoder.push("data: a\r")).toEqual([])
    expect(decoder.push("\r")).toEqual([])
    // The LF completes the held CR into a CRLF — the empty line dispatches.
    expect(decoder.push("\n")).toEqual([{ event: "message", data: "a", lastEventId: "" }])
    expect(decoder.push("data: b\n\n")).toEqual([{ event: "message", data: "b", lastEventId: "" }])
  })

  it("resolves a held CR as a CRLF half without dispatching an empty line", () => {
    // "data: b\r\n": the held \r joins the arriving LF, so the line ends
    // after the data and no empty line was seen yet.
    const decoder = new ServerSentEventDecoder()
    expect(decoder.push("data: b\r")).toEqual([])
    expect(decoder.push("\n")).toEqual([])
    // The next blank line now dispatches the event.
    expect(decoder.push("\n")).toEqual([{ event: "message", data: "b", lastEventId: "" }])
  })

  it("dispatches on the bare-CR empty line once the next chunk disambiguates", () => {
    // Split the CR pair of "data: a\r\rdata: b\r\r" between pushes: each
    // held \r turns out to be a bare-CR empty line, dispatching in turn —
    // the wire's final CR is resolved by end().
    const decoder = new ServerSentEventDecoder()
    expect(decoder.push("data: a\r\r")).toEqual([])
    expect(decoder.push("data: b\r")).toEqual([{ event: "message", data: "a", lastEventId: "" }])
    expect(decoder.push("\r")).toEqual([])
    expect(decoder.end()).toEqual([{ event: "message", data: "b", lastEventId: "" }])
  })

  it("end() flushes a trailing CR and drops unterminated events, then resets state", () => {
    const decoder = new ServerSentEventDecoder()
    // "data: done\n\r": the final CR completes an empty line → dispatch.
    expect(decoder.push("data: done\n")).toEqual([])
    expect(decoder.push("\r")).toEqual([])
    expect(decoder.end()).toEqual([{ event: "message", data: "done", lastEventId: "" }])

    // Unterminated event (no blank line) is discarded per spec.
    expect(decoder.push("event: e\ndata: orphan")).toEqual([])
    expect(decoder.end()).toEqual([])

    // State is fully reset — the decoder is reusable as a fresh one.
    expect(decoder.push("data: after-end\n\n")).toEqual([
      { event: "message", data: "after-end", lastEventId: "" },
    ])
    expect(decoder.end()).toEqual([])
  })

  it("defaults the event type to message and honors explicit event fields", () => {
    const decoder = new ServerSentEventDecoder()
    expect(decoder.push("event: delta\ndata: 1\n\n")).toEqual([
      { event: "delta", data: "1", lastEventId: "" },
    ])
    expect(decoder.push("data: 2\n\n")).toEqual([
      // event type resets after dispatch
      { event: "message", data: "2", lastEventId: "" },
    ])
  })
})

describe("readServerSentEvents", () => {
  it("cancels the underlying stream when the consumer exits early", async () => {
    let cancelled = false
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(ENC.encode("data: one\n\n"))
        controller.enqueue(ENC.encode("data: two\n\n"))
      },
      cancel() {
        cancelled = true
      },
    })
    const seen: ServerSentEvent[] = []
    for await (const event of readServerSentEvents(stream)) {
      seen.push(event)
      break
    }
    // Allow the finally-block cancel() promise to settle.
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(seen).toEqual([{ event: "message", data: "one", lastEventId: "" }])
    expect(cancelled).toBe(true)
    expect(stream.locked).toBe(false)
  })

  it("cancels the reader with the abort reason when the signal fires", async () => {
    let cancelReason: unknown = "not-cancelled"
    const stream = new ReadableStream<Uint8Array>({
      cancel(reason) {
        cancelReason = reason
      },
      // Never enqueues — the consumer would hang forever without the abort.
      start() {},
    })
    const controller = new AbortController()
    const consumed = (async () => {
      for await (const event of readServerSentEvents(stream, controller.signal)) {
        void event
      }
    })()
    controller.abort("client-closed")
    await consumed
    expect(cancelReason).toBe("client-closed")
    expect(stream.locked).toBe(false)
  })

  it("decodes multi-byte characters split across chunk boundaries", async () => {
    const bytes = ENC.encode("data: 世界\n\n") // "data: " = 6 bytes, 世 = E4 B8 96
    // Split inside the first multi-byte character (between its 2nd and 3rd byte).
    const events = await collect([bytes.slice(0, 8), bytes.slice(8)])
    expect(events).toEqual([{ event: "message", data: "世界", lastEventId: "" }])
  })
})
