// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT

/**
 * Server-level event feed (opencode `event-feed.ts` / event-stream
 * architecture borrowing): one Server-scoped ENCODED feed with one
 * independently bounded queue per connection.
 *
 * Before this layer, every SSE connection filtered + JSON.stringify'd the
 * event itself, so schema and wire encoding ran N times for N connected
 * clients. Here `publish` encodes the frame exactly ONCE into an immutable
 * string and offers that same string reference to every matching
 * connection's bounded dropping queue:
 *
 *   publish(name, payload)
 *     └─ encode once
 *          ├─ queue A ── HTTP A
 *          ├─ queue B ── HTTP B
 *          └─ queue C ── HTTP C
 *
 * Delivery law (opencode): a connection has an independent finite lag
 * budget. Exceeding it terminates ONLY that connection with a structured
 * SubscriberOverflowError while publication and healthy connections
 * continue in order. Neither the publisher nor healthy connections ever
 * block: offers are synchronous pushes into a bounded array, and overflow
 * just evicts the one stale connection.
 *
 * Connection write-backpressure: the transport's `write` reports `false`
 * when the client cannot accept more right now (e.g. the ReadableStream's
 * desiredSize is exhausted); queued frames drain opportunistically via the
 * scheduler (default `queueMicrotask`). Heartbeats and connect notices are
 * written by the caller directly to the transport — they never enter (or
 * consume budget from) the per-connection queue.
 */

export const SUBSCRIBER_CAPACITY = 4_096

/** Overflow kills exactly one connection; publisher and peers continue. */
export class SubscriberOverflowError extends Error {
  readonly capacity: number
  readonly connectionId: string
  constructor(connectionId: string, capacity: number) {
    super(
      `event feed subscriber "${connectionId}" exceeded its lag budget of ${capacity} frames and was disconnected`,
    )
    this.name = "SubscriberOverflowError"
    this.connectionId = connectionId
    this.capacity = capacity
  }
}

/**
 * Encode one SSE frame. The `event:`/`data:` wire contract is unchanged
 * from the per-client encoding it replaces; the name is validated because
 * it interpolates into the frame.
 */
export function encodeEventFrame(name: string, payload: unknown): string {
  if (name === "" || /[\r\n]/.test(name)) {
    throw new Error(`invalid event name: ${JSON.stringify(name)}`)
  }
  return `event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`
}

export interface EventFeedSubscribeOptions {
  /** Unique connection id (used for unsubscribe + overflow reporting). */
  id: string
  /** Event names to receive; empty = all. */
  events?: readonly string[]
  /** Tenant scope; a connection with a tenant only receives that tenant's events. */
  tenantId?: string
  /**
   * Transport write. Return false to refuse the frame (transport
   * saturated) — it stays queued and drain is rescheduled. Returning true
   * means the frame left the queue.
   */
  write: (frame: string) => boolean
  /** Called once when this connection is killed by overflow. */
  onOverflow?: (err: SubscriberOverflowError) => void
  /** Per-connection lag budget in frames. Default SUBSCRIBER_CAPACITY. */
  capacity?: number
}

export interface EventFeedConnection {
  readonly id: string
  /** Frames accepted but not yet handed to the transport. */
  lag(): number
  /** Remove this connection from the feed (idempotent). */
  close(): void
}

interface FeedConnection {
  readonly id: string
  readonly events: ReadonlySet<string>
  readonly acceptsAll: boolean
  readonly tenantId: string | undefined
  readonly write: (frame: string) => boolean
  readonly onOverflow: ((err: SubscriberOverflowError) => void) | undefined
  readonly capacity: number
  pending: string[]
  scheduled: boolean
}

export interface EventFeedOptions {
  /** Default per-connection capacity. Default SUBSCRIBER_CAPACITY. */
  capacity?: number
  /** Drain scheduler. Default `queueMicrotask` (injectable for tests). */
  schedule?: (fn: () => void) => void
  /**
   * Delay between drain retries while a transport stays saturated
   * (macrotask, never a microtask spin). Default 25ms.
   */
  saturatedRetryMs?: number
}

export class EventFeed {
  private readonly connections = new Map<string, FeedConnection>()
  private readonly defaultCapacity: number
  private readonly schedule: (fn: () => void) => void
  private readonly saturatedRetryMs: number

  constructor(opts?: EventFeedOptions) {
    this.defaultCapacity = Math.max(1, opts?.capacity ?? SUBSCRIBER_CAPACITY)
    this.schedule = opts?.schedule ?? ((fn) => queueMicrotask(fn))
    this.saturatedRetryMs = Math.max(1, opts?.saturatedRetryMs ?? 25)
  }

  get size(): number {
    return this.connections.size
  }

  subscribe(opts: EventFeedSubscribeOptions): EventFeedConnection {
    const connection: FeedConnection = {
      id: opts.id,
      events: new Set(opts.events ?? []),
      acceptsAll: (opts.events?.length ?? 0) === 0,
      tenantId: opts.tenantId,
      write: opts.write,
      onOverflow: opts.onOverflow,
      capacity: Math.max(1, opts.capacity ?? this.defaultCapacity),
      pending: [],
      scheduled: false,
    }
    this.connections.set(connection.id, connection)
    return {
      id: connection.id,
      lag: () => connection.pending.length,
      close: () => this.unsubscribe(connection.id),
    }
  }

  unsubscribe(id: string): void {
    this.connections.delete(id)
  }

  /**
   * Publish one event to every matching connection. The frame is encoded
   * ONCE (a no-op when nobody is listening) and the same immutable string
   * is offered to each queue — per-connection work is a filter check and
   * an array push, never a re-encode.
   */
  publish(name: string, payload: unknown, tenantId?: string): void {
    if (this.connections.size === 0) return
    const frame = encodeEventFrame(name, payload)
    for (const connection of [...this.connections.values()]) {
      if (!matches(connection, name, tenantId)) continue
      this.offer(connection, frame)
    }
  }

  // ── internals ───────────────────────────────────────────────────────────

  private offer(connection: FeedConnection, frame: string): void {
    if (connection.pending.length >= connection.capacity) {
      // Lag budget exhausted: kill exactly this connection. The publisher
      // and every healthy connection continue unaffected.
      this.connections.delete(connection.id)
      connection.pending = []
      connection.onOverflow?.(new SubscriberOverflowError(connection.id, connection.capacity))
      return
    }
    connection.pending.push(frame)
    if (!connection.scheduled) {
      connection.scheduled = true
      this.schedule(() => this.drain(connection))
    }
  }

  private drain(connection: FeedConnection): void {
    connection.scheduled = false
    // The connection may have been unsubscribed (or killed) after the
    // drain was scheduled; a detached queue must never reach a transport.
    if (!this.connections.has(connection.id)) return
    while (connection.pending.length > 0) {
      const frame = connection.pending[0]
      if (frame === undefined) break
      let accepted = false
      try {
        accepted = connection.write(frame)
      } catch {
        accepted = false
      }
      if (!accepted) {
        // Transport saturated (client not reading): retry on a macrotask.
        // One pending retry per lagging connection — the publisher and
        // healthy connections are never involved.
        const retry = setTimeout(() => this.drain(connection), this.saturatedRetryMs)
        retry.unref?.()
        return
      }
      connection.pending.shift()
    }
  }
}

function matches(connection: FeedConnection, name: string, tenantId: string | undefined): boolean {
  if (connection.tenantId !== undefined && connection.tenantId !== tenantId) return false
  return connection.acceptsAll || connection.events.has(name)
}
