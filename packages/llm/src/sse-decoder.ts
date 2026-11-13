// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT

/**
 * WHATWG Server-Sent Events decoder (deepseek chat-demo sse.ts borrowing).
 *
 * Byte stream → UTF-8 decode → split lines on CRLF / LF / CR → accumulate
 * fields → dispatch an event on the blank line. Implements the "event stream
 * interpretation" algorithm from
 * https://html.spec.whatwg.org/multipage/server-sent-events.html#event-stream-interpretation
 *
 * Why a stateful decoder instead of scanning the accumulated text for `\n\n`:
 * a network chunk boundary can fall inside a CRLF pair, leaving a lone `\r`
 * at the end of one chunk and the `\n` at the start of the next. Per-chunk
 * normalization (e.g. `.replace(/\r\n/g, "\n")`) never sees that pairing, so
 * the stray `\r` survives, a `\r\n\r\n` frame terminator never matches a
 * `\n\n` scan, and the frame stays stuck in the buffer until later bytes
 * happen to complete a boundary — gluing consecutive frames together. The
 * decoder below keeps the ambiguous trailing CR buffered until the next
 * chunk reveals whether it is a bare-CR line ending or the first half of a
 * CRLF pair. The same applies to any line terminator: framing decisions are
 * only made on text that is known to be complete.
 */

export type ServerSentEvent = {
  /** `event` field of the frame, defaulting to `message` */
  event: string
  /** Multiple `data` lines of the frame joined with `\n` */
  data: string
  /** Most recent `id` field seen so far (persists across events per spec) */
  lastEventId: string
}

const LINE_BREAK = /\r\n|\r|\n/g

export class ServerSentEventDecoder {
  private buffer = ""
  private data = ""
  private hasData = false
  private eventType = ""
  private lastEventId = ""

  /**
   * Feed one decoded text chunk, return every event completed inside it.
   *
   * A CR that is the last character of the buffer is deliberately left
   * unconsumed: it may be a bare-CR line ending, or the first half of a CRLF
   * pair whose LF arrives with the next chunk. Deciding early would misparse
   * a following LF as part of the next line, so the ambiguity is resolved by
   * the next push() or by end().
   */
  push(text: string): ServerSentEvent[] {
    this.buffer += text
    const events: ServerSentEvent[] = []
    let lineStart = 0
    LINE_BREAK.lastIndex = 0
    for (let match = LINE_BREAK.exec(this.buffer); match; match = LINE_BREAK.exec(this.buffer)) {
      // Trailing CR may be the first half of a CRLF pair — wait for more input
      if (match[0] === "\r" && LINE_BREAK.lastIndex === this.buffer.length) {
        break
      }
      const event = this.processLine(this.buffer.slice(lineStart, match.index))
      if (event) {
        events.push(event)
      }
      lineStart = LINE_BREAK.lastIndex
    }
    this.buffer = this.buffer.slice(lineStart)
    return events
  }

  /**
   * Stream finished. At EOF a trailing CR is a complete line ending — the
   * spec treats CR, LF and CRLF alike as line terminators, and there is no
   * further chunk that could turn the CR into the first half of a CRLF pair
   * (this dual meaning of a trailing CR is exactly why it must be buffered
   * during push() but resolved here). Any other event not terminated by a
   * blank line is dropped per the spec, because only blank lines dispatch.
   */
  end(): ServerSentEvent[] {
    const event = this.buffer.endsWith("\r") ? this.processLine(this.buffer.slice(0, -1)) : null
    this.buffer = ""
    this.data = ""
    this.hasData = false
    this.eventType = ""
    return event ? [event] : []
  }

  private processLine(line: string): ServerSentEvent | null {
    if (line === "") {
      return this.dispatch()
    }
    if (line.startsWith(":")) {
      return null // comment line (e.g. server keep-alive `: ping`)
    }
    const colon = line.indexOf(":")
    const field = colon === -1 ? line : line.slice(0, colon)
    let value = colon === -1 ? "" : line.slice(colon + 1)
    if (value.startsWith(" ")) {
      value = value.slice(1) // strip exactly one optional space after the colon
    }
    switch (field) {
      case "data":
        this.data = this.hasData ? `${this.data}\n${value}` : value
        this.hasData = true
        break
      case "event":
        this.eventType = value
        break
      case "id":
        // Per spec, an `id` field whose value contains NUL must be ignored
        if (!value.includes("\0")) {
          this.lastEventId = value
        }
        break
      default:
        break // `retry` only matters to EventSource reconnection — unused here
    }
    return null
  }

  private dispatch(): ServerSentEvent | null {
    const event: ServerSentEvent | null = this.hasData
      ? { event: this.eventType || "message", data: this.data, lastEventId: this.lastEventId }
      : null
    this.data = ""
    this.hasData = false
    this.eventType = ""
    return event
  }
}

/**
 * Yield the SSE events of a byte stream one by one; the stream ends when the
 * body is exhausted. On abort or when the consumer exits early, the reader is
 * cancelled so the connection is released — do not rely on the underlying
 * network propagating the abort into the response body.
 */
export async function* readServerSentEvents(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<ServerSentEvent> {
  const reader = stream.getReader()
  const onAbort = () => {
    reader.cancel(signal?.reason).catch(() => {})
  }
  signal?.addEventListener("abort", onAbort, { once: true })
  // TextDecoder strips a leading BOM by default; stream: true keeps
  // multi-byte characters intact across chunk boundaries
  const textDecoder = new TextDecoder()
  const decoder = new ServerSentEventDecoder()
  let finished = false
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) {
        finished = true
        yield* decoder.push(textDecoder.decode())
        yield* decoder.end()
        return
      }
      yield* decoder.push(textDecoder.decode(value, { stream: true }))
    }
  } finally {
    signal?.removeEventListener("abort", onAbort)
    if (!finished) {
      reader.cancel().catch(() => {})
    }
    reader.releaseLock()
  }
}
