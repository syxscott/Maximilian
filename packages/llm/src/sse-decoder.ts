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
 * The scan is linear in the input (pi #12451 mechanism): each push() walks
 * only the text that just arrived, an unfinished line is kept as pending
 * segments and joined once when its terminator arrives, and `data:` lines
 * accumulate in an array joined at dispatch time. Rescanning the accumulated
 * buffer per chunk (the previous implementation) made one large event O(n²):
 * locally a single 16 MiB event in 64 KiB chunks took ~3.2 s before and is
 * tens of milliseconds after.
 *
 * A trailing CR is held back because it may be a bare-CR line ending or the
 * first half of a CRLF pair whose LF arrives with the next chunk; framing
 * decisions are only made on text that is known to be complete.
 */

export type ServerSentEvent = {
  /** `event` field of the frame, defaulting to `message` */
  event: string
  /** Multiple `data` lines of the frame joined with `\n` */
  data: string
  /** Most recent `id` field seen so far (persists across events per spec) */
  lastEventId: string
}

/** Options for {@link ServerSentEventDecoder}. */
export interface ServerSentEventDecoderOptions {
  /**
   * Maximum bytes buffered for one unfinished event, including its line
   * terminators. When the current event grows past this, that event is
   * discarded and parsing resumes at the next event boundary — a single
   * runaway frame cannot pin memory forever (cc-switch proxy/sse.rs
   * borrowing). Omit (default) to buffer without a limit.
   */
  maxPendingBytes?: number
}

/** Options for {@link readServerSentEvents}. */
export interface ReadServerSentEventsOptions {
  /** Forwarded to the decoder; see {@link ServerSentEventDecoderOptions.maxPendingBytes}. */
  maxPendingBytes?: number
  /**
   * Invoked once per dropped oversized event with the running total. Drops
   * are otherwise silent so a consumer can keep streaming after a bad frame.
   */
  onOversizedEvent?: (droppedOversizedEvents: number) => void
}

const utf8ByteLength = new TextEncoder()

/** UTF-8 byte length of a decoded text fragment. */
function byteLength(text: string): number {
  return text.length === 0 ? 0 : utf8ByteLength.encode(text).length
}

export class ServerSentEventDecoder {
  private readonly maxPendingBytes: number | undefined
  /** Segments of the line that has not seen its terminator yet. */
  private pendingParts: string[] = []
  /** Whether the pending line already has content (tracked while dropping too). */
  private pendingLineHasContent = false
  /** True when the last consumed character was a CR whose meaning is unresolved. */
  private pendingCr = false
  /** Bytes of the current unfinished event (only tracked when limited). */
  private pendingEventBytes = 0
  /** True while the current event is being discarded for exceeding the cap. */
  private dropCurrentEvent = false
  /** `data:` values of the current event, joined at dispatch time. */
  private dataParts: string[] = []
  private eventType = ""
  private lastEventId = ""
  /** `lastEventId` at the start of the current event, restored if it is dropped. */
  private eventStartLastEventId = ""
  private droppedCount = 0

  constructor(options: ServerSentEventDecoderOptions = {}) {
    const max = options.maxPendingBytes
    if (max !== undefined && (!Number.isFinite(max) || max <= 0)) {
      throw new Error(
        `ServerSentEventDecoder: maxPendingBytes must be a positive number, got ${String(max)}`,
      )
    }
    this.maxPendingBytes = max
  }

  /** Number of events discarded so far for exceeding `maxPendingBytes`. */
  get droppedOversizedEvents(): number {
    return this.droppedCount
  }

  /**
   * Feed one decoded text chunk, return every event completed inside it.
   *
   * A CR that is the last character of the input is deliberately left
   * unconsumed: it may be a bare-CR line ending, or the first half of a CRLF
   * pair whose LF arrives with the next chunk. Deciding early would misparse
   * a following LF as part of the next line, so the ambiguity is resolved by
   * the next push() or by end().
   */
  push(text: string): ServerSentEvent[] {
    const events: ServerSentEvent[] = []
    if (text.length === 0) return events

    if (this.pendingCr) {
      // Previous push ended on a CR. A leading LF completes the CRLF pair;
      // anything else proves it was a bare-CR terminator.
      text = this.resolvePendingLine(text, events)
    }

    let start = 0
    for (;;) {
      const lf = text.indexOf("\n", start)
      const cr = text.indexOf("\r", start)
      const i = lf === -1 ? cr : cr === -1 ? lf : Math.min(lf, cr)
      if (i === -1) break
      const segment = text.slice(start, i)
      // Every raw byte is counted exactly once, as it is consumed.
      this.countTextBytes(segment)
      if (text[i] === "\r" && i + 1 === text.length) {
        // Hold the trailing CR until the next chunk (or end()) disambiguates.
        this.appendPending(segment)
        this.pendingCr = true
        return events
      }
      if (text[i] === "\r" && text[i + 1] === "\n") {
        this.completeLine(segment, 2, events)
        start = i + 2 // consume the LF half of the CRLF pair
      } else {
        this.completeLine(segment, 1, events)
        start = i + 1
      }
    }
    const tail = text.slice(start)
    this.appendPending(tail)
    this.countTextBytes(tail)
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
    const events: ServerSentEvent[] = []
    if (this.pendingCr) {
      this.resolvePendingLine("", events)
    }
    // Any remaining pending text has no line terminator, so it cannot form a
    // dispatchable event; reset the per-event state and keep `lastEventId`.
    this.reset()
    return events
  }

  /**
   * Resolve the CR held over from the previous push: `text` starting with LF
   * completes a CRLF pair (2 terminator bytes), anything else was a bare-CR
   * terminator (1 byte). Returns the not-yet-scanned remainder of `text`.
   */
  private resolvePendingLine(text: string, events: ServerSentEvent[]): string {
    const terminatorBytes = text.startsWith("\n") ? 2 : 1
    const line = this.pendingLine()
    this.pendingParts = []
    this.completeLine(line, terminatorBytes, events)
    this.pendingCr = false
    return terminatorBytes === 2 ? text.slice(1) : text
  }

  /** Append the tail of a chunk to the line that is still unfinished. */
  private appendPending(segment: string): void {
    if (segment.length === 0) return
    this.pendingLineHasContent = true
    if (this.dropCurrentEvent) return
    this.pendingParts.push(segment)
  }

  /**
   * Terminate the current line and feed it to the field parser. `segment` is
   * the tail that arrived in this chunk; earlier segments live in
   * `pendingParts`. `terminatorBytes` counts toward the event size.
   */
  private completeLine(segment: string, terminatorBytes: number, events: ServerSentEvent[]): void {
    const lineHasContent = this.pendingLineHasContent || segment.length > 0
    this.pendingLineHasContent = false

    if (this.dropCurrentEvent) {
      // Only a blank line closes the discarded event; other lines are skipped.
      if (!lineHasContent) this.endDrop()
      return
    }

    const line = this.pendingParts.length > 0 ? this.pendingParts.join("") + segment : segment
    this.pendingParts = []
    this.addEventBytes(terminatorBytes)
    if (this.dropCurrentEvent) {
      // The terminator itself pushed the event over the cap. A blank line
      // still closes the dropped event; a content line keeps it dropped.
      if (!lineHasContent) this.endDrop()
      return
    }
    const event = this.processLine(line)
    if (event) events.push(event)
  }

  /** Count a consumed text fragment, unless no limit is configured. */
  private countTextBytes(text: string): void {
    if (text.length === 0 || this.maxPendingBytes === undefined) return
    this.addEventBytes(byteLength(text))
  }

  /**
   * Count bytes against the current unfinished event and start discarding it
   * as soon as the cap is exceeded. Only the offending event is dropped:
   * previously dispatched events are untouched, and parsing resumes at the
   * next blank line.
   */
  private addEventBytes(bytes: number): void {
    if (this.maxPendingBytes === undefined || this.dropCurrentEvent) return
    this.pendingEventBytes += bytes
    if (this.pendingEventBytes > this.maxPendingBytes) {
      this.dropCurrentEvent = true
      this.droppedCount += 1
      this.pendingEventBytes = 0
      this.pendingParts = []
      this.dataParts = []
      this.eventType = ""
      // The discarded event leaves no trace, not even an `id:` seen before
      // the cap was hit; parsing resumes from the pre-event cursor.
      this.lastEventId = this.eventStartLastEventId
    }
  }

  /** Resume normal parsing at the next event boundary. */
  private endDrop(): void {
    this.dropCurrentEvent = false
    this.pendingEventBytes = 0
    this.eventStartLastEventId = this.lastEventId
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
        this.dataParts.push(value)
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
    const event: ServerSentEvent | null =
      this.dataParts.length > 0
        ? {
            event: this.eventType || "message",
            data: this.dataParts.join("\n"),
            lastEventId: this.lastEventId,
          }
        : null
    this.dataParts = []
    this.eventType = ""
    this.pendingEventBytes = 0
    // The blank line opened a new event; remember the cursor it starts from.
    this.eventStartLastEventId = this.lastEventId
    return event
  }

  private pendingLine(): string {
    return this.pendingParts.join("")
  }

  /** Clear all per-event state (but not `lastEventId`, which is persistent). */
  private reset(): void {
    this.pendingParts = []
    this.pendingLineHasContent = false
    this.pendingCr = false
    this.dataParts = []
    this.eventType = ""
    this.pendingEventBytes = 0
    this.dropCurrentEvent = false
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
  options?: ReadServerSentEventsOptions,
): AsyncGenerator<ServerSentEvent> {
  const reader = stream.getReader()
  const onAbort = () => {
    reader.cancel(signal?.reason).catch(() => {})
  }
  signal?.addEventListener("abort", onAbort, { once: true })
  // TextDecoder strips a leading BOM by default; stream: true keeps
  // multi-byte characters intact across chunk boundaries
  const textDecoder = new TextDecoder()
  const decoder = new ServerSentEventDecoder({ maxPendingBytes: options?.maxPendingBytes })
  let dropped = 0
  const reportDrops = (): void => {
    if (decoder.droppedOversizedEvents > dropped) {
      dropped = decoder.droppedOversizedEvents
      options?.onOversizedEvent?.(dropped)
    }
  }
  let finished = false
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) {
        finished = true
        for (const event of decoder.push(textDecoder.decode())) {
          yield event
        }
        for (const event of decoder.end()) {
          yield event
        }
        reportDrops()
        return
      }
      for (const event of decoder.push(textDecoder.decode(value, { stream: true }))) {
        yield event
      }
      reportDrops()
    }
  } finally {
    signal?.removeEventListener("abort", onAbort)
    if (!finished) {
      reader.cancel().catch(() => {})
    }
    reader.releaseLock()
  }
}
