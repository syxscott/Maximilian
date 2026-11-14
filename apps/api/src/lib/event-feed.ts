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
 *
 * (borrowing OpenAgentCore sessions-events.md) Two further delivery laws
 * close the remaining leak paths:
 *
 *   Key recheck — an open stream rechecks its ORIGINAL authorization at
 *   most once per second while idle and BEFORE sending output. A revoked
 *   token closes exactly that stream (onAuthRevoked); bytes already sent
 *   cannot be recalled. The recheck is async; output simply waits for it
 *   when one is due — a five-second auth timeout delays, never leaks.
 *
 *   Blocked reader — "Execution never waits for a reader": a transport
 *   that stays saturated (write keeps reporting false) for longer than
 *   WRITE_BLOCK_TIMEOUT_MS (5s) has its connection killed (onWriteBlock).
 *   The publisher and healthy peers never notice.
 */

export const SUBSCRIBER_CAPACITY = 4_096

/** Idle auth recheck cadence (sessions-events.md: at most once/second). */
export const AUTH_RECHECK_INTERVAL_MS = 1_000
/** How long a blocked transport may hold a connection before it is killed. */
export const WRITE_BLOCK_TIMEOUT_MS = 5_000

/** Why a connection was killed by the feed itself. */
export type FeedDisconnectReason = "overflow" | "auth-revoked" | "write-block"

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
  /**
   * (sessions-events.md key recheck) Async recheck of the connection's
   * ORIGINAL authorization. Runs at most once per AUTH_RECHECK_INTERVAL_MS
   * while idle and before sending output; false (or a thrown recheck —
   * an authentication failure) closes exactly this stream.
   */
  recheckAuth?: () => Promise<boolean>
  /** Called once when this connection is closed because its auth was revoked. */
  onAuthRevoked?: () => void
  /**
   * Max ms this transport may stay blocked (write reporting false) before
   * the connection is killed. Default WRITE_BLOCK_TIMEOUT_MS; 0 disables.
   */
  writeBlockTimeoutMs?: number
  /** Called once when this connection is killed for staying blocked. */
  onWriteBlock?: (timeoutMs: number) => void
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
  readonly recheckAuth: (() => Promise<boolean>) | undefined
  readonly onAuthRevoked: (() => void) | undefined
  readonly onWriteBlock: ((timeoutMs: number) => void) | undefined
  readonly authIntervalMs: number
  readonly writeBlockTimeoutMs: number
  pending: string[]
  scheduled: boolean
  /** Wall clock of the last completed (or started) auth recheck. */
  lastAuthCheckAt: number
  /** In-flight recheck promise — at most one per connection. */
  authCheckInFlight: Promise<boolean> | undefined
  /** Idle recheck timer (armed only when recheckAuth is set). */
  authTimer: ReturnType<typeof setTimeout> | undefined
  /** Wall clock of the first failed write in the current blocked streak. */
  saturatedAt: number | null
  /** Fired when the blocked streak exceeds writeBlockTimeoutMs. */
  writeBlockTimer: ReturnType<typeof setTimeout> | undefined
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
  /** Idle auth recheck cadence. Default AUTH_RECHECK_INTERVAL_MS. */
  authRecheckIntervalMs?: number
  /** Blocked-transport kill timeout. Default WRITE_BLOCK_TIMEOUT_MS. */
  writeBlockTimeoutMs?: number
  /** Wall clock (injectable for tests). Default Date.now. */
  now?: () => number
}

export class EventFeed {
  private readonly connections = new Map<string, FeedConnection>()
  private readonly defaultCapacity: number
  private readonly schedule: (fn: () => void) => void
  private readonly saturatedRetryMs: number
  private readonly authRecheckIntervalMs: number
  private readonly writeBlockTimeoutMs: number
  private readonly now: () => number

  constructor(opts?: EventFeedOptions) {
    this.defaultCapacity = Math.max(1, opts?.capacity ?? SUBSCRIBER_CAPACITY)
    this.schedule = opts?.schedule ?? ((fn) => queueMicrotask(fn))
    this.saturatedRetryMs = Math.max(1, opts?.saturatedRetryMs ?? 25)
    this.authRecheckIntervalMs = Math.max(
      0,
      opts?.authRecheckIntervalMs ?? AUTH_RECHECK_INTERVAL_MS,
    )
    this.writeBlockTimeoutMs = Math.max(0, opts?.writeBlockTimeoutMs ?? WRITE_BLOCK_TIMEOUT_MS)
    this.now = opts?.now ?? Date.now
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
      recheckAuth: opts.recheckAuth,
      onAuthRevoked: opts.onAuthRevoked,
      onWriteBlock: opts.onWriteBlock,
      authIntervalMs: this.authRecheckIntervalMs,
      writeBlockTimeoutMs: Math.max(0, opts.writeBlockTimeoutMs ?? this.writeBlockTimeoutMs),
      pending: [],
      scheduled: false,
      // The connection opened behind an auth check — count it as fresh.
      lastAuthCheckAt: this.now(),
      authCheckInFlight: undefined,
      authTimer: undefined,
      saturatedAt: null,
      writeBlockTimer: undefined,
    }
    this.connections.set(connection.id, connection)
    if (connection.recheckAuth) this.armIdleRecheck(connection)
    return {
      id: connection.id,
      lag: () => connection.pending.length,
      close: () => this.unsubscribe(connection.id),
    }
  }

  unsubscribe(id: string): void {
    const connection = this.connections.get(id)
    if (connection) this.clearTimers(connection)
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
      this.kill(connection, "overflow", connection.capacity)
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
    // (sessions-events.md key recheck) Output waits for the recheck when
    // one is due (or already in flight); a revoked key closes the stream
    // before anything is sent.
    if (!this.outputGateOpen(connection)) {
      if (connection.recheckAuth && !connection.authCheckInFlight) {
        void this.runAuthRecheck(connection).then((alive) => {
          if (!alive || connection.pending.length === 0 || connection.scheduled) return
          connection.scheduled = true
          this.schedule(() => this.drain(connection))
        })
      }
      return
    }
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
        // healthy connections are never involved. The blocked streak is
        // timestamped so a transport that stays blocked past the timeout
        // kills exactly this connection ("Execution never waits for a
        // reader").
        this.markSaturated(connection)
        const retry = setTimeout(() => this.drain(connection), this.saturatedRetryMs)
        retry.unref?.()
        return
      }
      this.markHealthy(connection)
      connection.pending.shift()
    }
  }

  // ── key recheck (sessions-events.md) ─────────────────────────────────────

  /**
   * Output gate: true when frames may reach the transport now. Closed
   * while a recheck is due (stale by >= the cadence) or already running.
   */
  private outputGateOpen(connection: FeedConnection): boolean {
    if (!connection.recheckAuth) return true
    if (connection.authCheckInFlight) return false
    return this.now() - connection.lastAuthCheckAt < connection.authIntervalMs
  }

  /**
   * Run one auth recheck. Resolves false when the connection was closed
   * (revoked token or recheck failure — sessions-events.md counts an
   * authentication failure as stream-closing). At most one recheck per
   * connection runs at a time; the cadence gate lives in authCheckDue.
   */
  private async runAuthRecheck(connection: FeedConnection): Promise<boolean> {
    if (!connection.recheckAuth) return true
    if (connection.authCheckInFlight) return connection.authCheckInFlight
    const check = connection
      .recheckAuth()
      .catch(() => false) // recheck failure = authentication failure
      .finally(() => {
        if (connection.authCheckInFlight === check) connection.authCheckInFlight = undefined
        connection.lastAuthCheckAt = this.now()
      })
    connection.authCheckInFlight = check
    const alive = await check
    if (!alive && this.connections.has(connection.id)) {
      this.kill(connection, "auth-revoked")
      return false
    }
    return true
  }

  /**
   * Idle cadence: recheck at most once per second while the stream is
   * open, independent of traffic. Re-armed after every completed check.
   */
  private armIdleRecheck(connection: FeedConnection): void {
    const tick = () => {
      connection.authTimer = undefined
      if (!this.connections.has(connection.id)) return
      void this.runAuthRecheck(connection)
      // Re-arm regardless of the verdict — the kill path clears timers.
      if (this.connections.has(connection.id)) {
        connection.authTimer = this.startTimer(tick, connection.authIntervalMs)
      }
    }
    connection.authTimer = this.startTimer(tick, connection.authIntervalMs)
  }

  // ── blocked-reader timeout ────────────────────────────────────────────────

  private markSaturated(connection: FeedConnection): void {
    if (connection.writeBlockTimeoutMs <= 0) return
    if (connection.saturatedAt === null) {
      connection.saturatedAt = this.now()
      connection.writeBlockTimer = this.startTimer(() => {
        connection.writeBlockTimer = undefined
        // Still in the feed and still mid-streak: the reader never came
        // back within the budget.
        if (this.connections.has(connection.id) && connection.saturatedAt !== null) {
          this.kill(connection, "write-block", connection.writeBlockTimeoutMs)
        }
      }, connection.writeBlockTimeoutMs)
    }
  }

  private markHealthy(connection: FeedConnection): void {
    if (connection.saturatedAt === null) return
    connection.saturatedAt = null
    if (connection.writeBlockTimer) {
      clearTimeout(connection.writeBlockTimer)
      connection.writeBlockTimer = undefined
    }
  }

  // ── teardown ────────────────────────────────────────────────────────────

  /** Kill exactly this connection for `reason`; publisher and peers continue. */
  private kill(connection: FeedConnection, reason: FeedDisconnectReason, timeoutMs?: number): void {
    if (!this.connections.has(connection.id)) return
    this.clearTimers(connection)
    this.connections.delete(connection.id)
    connection.pending = []
    if (reason === "overflow") {
      connection.onOverflow?.(new SubscriberOverflowError(connection.id, connection.capacity))
    }
    if (reason === "auth-revoked") connection.onAuthRevoked?.()
    if (reason === "write-block")
      connection.onWriteBlock?.(timeoutMs ?? connection.writeBlockTimeoutMs)
  }

  private clearTimers(connection: FeedConnection): void {
    if (connection.authTimer) {
      clearTimeout(connection.authTimer)
      connection.authTimer = undefined
    }
    if (connection.writeBlockTimer) {
      clearTimeout(connection.writeBlockTimer)
      connection.writeBlockTimer = undefined
    }
    connection.saturatedAt = null
  }

  private startTimer(fn: () => void, ms: number): ReturnType<typeof setTimeout> {
    const timer = setTimeout(fn, ms)
    // Timers must never hold the process open by themselves.
    timer.unref?.()
    return timer
  }
}

function matches(connection: FeedConnection, name: string, tenantId: string | undefined): boolean {
  if (connection.tenantId !== undefined && connection.tenantId !== tenantId) return false
  return connection.acceptsAll || connection.events.has(name)
}
