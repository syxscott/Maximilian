// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * SSE connection keepalive loop (pi `apps/p2/src/web/reconnect.ts`
 * borrowing): keeps one stream open to the server, replaces it when it
 * ends, and notices dead ones early.
 *
 * Why: the fetch+ReadableStream transport in `src/api.ts` does NOT
 * auto-reconnect the way the native `EventSource` did. Before this loop
 * the App re-opened the stream immediately on every transport error, gave
 * up permanently after `SSE_MAX_RETRIES` consecutive failures, and never
 * noticed a silently-dead socket at all (a clean server drop without an
 * error frame left the UI spinning on a closed stream forever).
 *
 * The loop, verbatim from the reference mechanism:
 *   - After a close it retries with backoff (250 ms doubling, capped at
 *     5 s). A connection that stayed open `STABLE_MS` counted as working,
 *     so the next retry starts again at the initial delay; one that opens
 *     and dies at once keeps backing off instead of hot-looping.
 *   - An attempt not open after `CONNECT_TIMEOUT_MS` is given up — the
 *     browser fetch has no handshake timeout of its own.
 *   - On wake (online / visible / pageshow / network change) a pending
 *     retry runs at once, and an open socket that has heard nothing for
 *     `STALE_MS` is replaced after a `WAKE_GRACE_MS` grace (a frozen or
 *     throttled page gets held messages that long before the check
 *     replaces a socket that is actually fine).
 *   - With `silenceTimeoutMs` set, an open socket is ALSO replaced whenever
 *     it stays silent that long at any time — only sound when the server's
 *     keepalive is a visible frame. The workspace stream heartbeats with
 *     `:` comment frames which the SSE decoder drops (spec: comments never
 *     dispatch), so for that stream the option stays OFF and liveness is
 *     judged only at wake time; the opencode events stream heartbeats with
 *     real data frames every 15 s, so there the option is ON.
 *   - Every close goes through the asynchronous `canRetry()` gate before
 *     anything is scheduled; returning false parks the loop permanently.
 *
 * Zero DOM dependency in the loop itself: time, timers, online state, wake
 * events and logging are all injected via `KeepaliveEnvironment`, which is
 * what makes the timing behavior testable without a real socket.
 */

/** Retry delays after a failed or short-lived connection: 250 ms, doubling, at most 5 s. */
export const RETRY_INITIAL_MS = 250
export const RETRY_MAX_MS = 5000
/** A connection that stayed open this long counted as working: the next retry starts again at the initial delay. */
export const STABLE_MS = 10_000
/** An attempt not open after this long is given up (browsers have no handshake timeout). */
export const CONNECT_TIMEOUT_MS = 20_000
/** On wake, an open socket silent for longer than this is presumed dead and replaced. */
export const STALE_MS = 25_000
/**
 * After a wake, frames held while the page was frozen get this long to
 * arrive before a stale-socket check replaces the connection.
 */
export const WAKE_GRACE_MS = 1000

/** What the loop learns about one open attempt from its transport. */
export interface KeepaliveSocketEvents {
  /** The transport finished connecting successfully. */
  opened(): void
  /**
   * Any frame arrived. This is the only liveness signal: the workspace
   * stream's `: ping` comment heartbeats are dropped by the SSE decoder
   * and never surface here, while the opencode stream's heartbeat frames
   * do — either way "received a frame" means the socket is alive.
   */
  received(): void
  /** The transport reported a close, with its own reason (for the log). */
  closed(reason: string): void
}

/**
 * One live connection over which the loop can learn it ended. `onClose`
 * must fire exactly once per attempt — when the transport dies OR when
 * `close()` is called (including by the loop itself for silence/timeout),
 * which is what drives the retry decision.
 */
export interface KeepaliveLink {
  onClose(handler: (reason: string) => void): void
  close(reason?: string): void
}

export interface KeepaliveEnvironment {
  now(): number
  /** Runs `callback` after `ms`; returns a cancel function. */
  after(ms: number, callback: () => void): () => void
  /** False when the device is known to be offline. */
  online(): boolean
  /**
   * `listener` runs when the page may have been away: back online, visible
   * again, network changed, or restored from the back/forward cache.
   * Returns a function that removes it.
   */
  onWake(listener: () => void): () => void
  log(message: string): void
}

export interface SseKeepaliveOptions {
  /** Opens one connection and its link; the connection reports to `events`. */
  open(events: KeepaliveSocketEvents): KeepaliveLink
  /** Connection-state change notification (reconnect-success hooks, UI flags). */
  onConnected?(connected: boolean): void
  /**
   * Asked after every close; false stops reconnecting (a newer submission
   * replaced this stream, or the caller gave up on a permanent failure).
   */
  canRetry(): Promise<boolean>
  /**
   * Replace an open socket after this long without a received frame, at any
   * time — NOT only on wake. Only enable this when the server's keepalive
   * arrives as a visible data frame (see the class comment for the two
   * streams' differing heartbeat visibility).
   */
  silenceTimeoutMs?: number
  environment: KeepaliveEnvironment
}

export interface SseKeepaliveHandle {
  /**
   * Stop the loop permanently: cancels pending retries and timers, closes
   * the current connection, and ignores late close reports. Safe to call
   * more than once.
   */
  stop(): void
}

type Attempt = {
  link: KeepaliveLink | undefined
  startedAt: number
  /** When the socket opened; undefined while connecting. */
  openedAt: number | undefined
  lastMessage: number
  cancelTimeout: () => void
  cancelWatch: () => void
}

/**
 * Keeps the caller connected until stopped (pi reconnect.ts borrowing):
 *
 * - After a close it retries with backoff. A connection that stayed open
 *   STABLE_MS resets the backoff; one that opens and ends at once (an
 *   older server refusing the protocol, for instance) keeps backing off
 *   instead of looping.
 * - An attempt not open after CONNECT_TIMEOUT_MS is given up.
 * - On wake (online, visible, network change, back/forward cache) a
 *   pending retry runs at once, and an open socket that has heard nothing
 *   for STALE_MS is replaced. After a network change the socket looks fine
 *   until the server's next frame fails to arrive, so the check runs when
 *   that frame is overdue rather than only now.
 * - With `silenceTimeoutMs`, an open socket is also replaced whenever it
 *   stays silent that long. A check that runs late (a frozen or throttled
 *   page) first gives held messages WAKE_GRACE_MS to arrive.
 * - Every close is logged with whether it happened before or after the
 *   transport opened: one that never opened is a refused handshake, one
 *   after opening a dropped connection.
 */
export function createSseKeepalive(options: SseKeepaliveOptions): SseKeepaliveHandle {
  const env = options.environment
  let failures = 0
  let current: Attempt | undefined
  let cancelRetry: (() => void) | undefined
  /** Between a close and the retry decision (canRetry is asynchronous). */
  let deciding = false
  let wokeWhileDeciding = false
  let cancelStaleCheck: (() => void) | undefined
  let stopped = false

  const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`

  /**
   * Replaces `attempt` once it is silent longer than `limit`; reschedules
   * itself while frames keep arriving. A check that fires late (throttled
   * page) first gives held messages WAKE_GRACE_MS to arrive.
   */
  const watch = (attempt: Attempt, limit: number): void => {
    const scheduledAt = attempt.lastMessage + limit + 1
    attempt.cancelWatch = env.after(Math.max(0, scheduledAt - env.now()), () => {
      if (current !== attempt) return
      const now = env.now()
      const silent = now - attempt.lastMessage
      if (silent <= limit) watch(attempt, limit)
      else if (now - scheduledAt > WAKE_GRACE_MS)
        attempt.cancelWatch = env.after(WAKE_GRACE_MS, () => {
          if (current !== attempt) return
          if (env.now() - attempt.lastMessage <= limit) watch(attempt, limit)
          else
            attempt.link?.close(
              `no frame from the server for ${seconds(env.now() - attempt.lastMessage)}`,
            )
        })
      else attempt.link?.close(`no frame from the server for ${seconds(silent)}`)
    })
  }

  const connect = (): void => {
    cancelRetry = undefined
    const attempt: Attempt = {
      link: undefined,
      startedAt: env.now(),
      openedAt: undefined,
      lastMessage: env.now(),
      cancelTimeout: () => {},
      cancelWatch: () => {},
    }
    current = attempt
    const link = options.open({
      opened: () => {
        if (current !== attempt) return
        attempt.openedAt = attempt.lastMessage = env.now()
        attempt.cancelTimeout()
        if (options.silenceTimeoutMs !== undefined) watch(attempt, options.silenceTimeoutMs)
        options.onConnected?.(true)
      },
      received: () => {
        attempt.lastMessage = env.now()
      },
      closed: (reason) => {
        const opened = attempt.openedAt === undefined ? "before opening" : "after opening"
        env.log(`Stream closed ${opened}: ${reason}`)
      },
    })
    attempt.link = link
    attempt.cancelTimeout = env.after(CONNECT_TIMEOUT_MS, () => {
      if (attempt.openedAt === undefined)
        link.close(`not open after ${seconds(CONNECT_TIMEOUT_MS)}`)
    })
    link.onClose((reason) => closed(attempt, reason))
  }

  const closed = (attempt: Attempt, reason: string): void => {
    if (current !== attempt) return
    current = undefined
    attempt.cancelTimeout()
    attempt.cancelWatch()
    cancelStaleCheck?.()
    cancelStaleCheck = undefined
    if (stopped) return
    options.onConnected?.(false)
    const now = env.now()
    if (attempt.openedAt === undefined)
      env.log(`Connection failed after ${seconds(now - attempt.startedAt)}: ${reason}`)
    else env.log(`Connection lost after ${seconds(now - attempt.openedAt)} open: ${reason}`)
    if (attempt.openedAt !== undefined && now - attempt.openedAt >= STABLE_MS) failures = 0
    deciding = true
    wokeWhileDeciding = false
    void options
      .canRetry()
      .then((retry) => {
        deciding = false
        if (retry) schedule(wokeWhileDeciding)
      })
      .catch(() => {
        deciding = false
        schedule(wokeWhileDeciding)
      })
  }

  const schedule = (now: boolean): void => {
    if (stopped) return
    const backoff = Math.min(RETRY_MAX_MS, RETRY_INITIAL_MS * 2 ** failures)
    failures += 1
    // Offline, an attempt fails at once; the `online` wake retries sooner than this.
    const delay = now ? 0 : env.online() ? backoff : RETRY_MAX_MS
    cancelRetry = env.after(delay, connect)
  }

  const wake = (): void => {
    if (stopped) return
    if (cancelRetry) {
      cancelRetry()
      connect()
      return
    }
    if (deciding) {
      wokeWhileDeciding = true
      return
    }
    const attempt = current
    // A connecting attempt has its own timeout.
    if (attempt?.openedAt === undefined) return
    cancelStaleCheck?.()
    const check = (): void => {
      cancelStaleCheck = undefined
      const silent = env.now() - attempt.lastMessage
      if (current === attempt && silent > STALE_MS)
        attempt.link?.close(`no frame from the server for ${seconds(silent)}`)
    }
    cancelStaleCheck = env.after(
      Math.max(WAKE_GRACE_MS, attempt.lastMessage + STALE_MS + 1 - env.now()),
      check,
    )
  }

  const removeWake = env.onWake(wake)
  connect()
  return {
    stop: () => {
      if (stopped) return
      stopped = true
      removeWake()
      cancelRetry?.()
      cancelRetry = undefined
      current?.link?.close("stopped")
    },
  }
}

/**
 * The page's environment (pi reconnect.ts borrowing): wakes on `online`,
 * visibility, network changes (where reported) and back/forward restores.
 * Logs go to the console under `name`. DOM-dependent by design — the loop
 * itself only sees the injected interface.
 */
export function browserEnvironment(name: string): KeepaliveEnvironment {
  return {
    now: () => Date.now(),
    after: (ms, callback) => {
      const timer = setTimeout(callback, ms)
      return () => clearTimeout(timer)
    },
    online: () => navigator.onLine,
    onWake: (listener) => {
      const pageshow = (event: PageTransitionEvent) => {
        if (event.persisted) listener()
      }
      const visibility = () => {
        if (document.visibilityState === "visible") listener()
      }
      // Chromium only: Wi-Fi to cellular and back, which leaves the old
      // socket dead without telling anyone.
      const network = (navigator as { connection?: EventTarget }).connection
      window.addEventListener("online", listener)
      window.addEventListener("pageshow", pageshow)
      document.addEventListener("visibilitychange", visibility)
      network?.addEventListener("change", listener)
      return () => {
        window.removeEventListener("online", listener)
        window.removeEventListener("pageshow", pageshow)
        document.removeEventListener("visibilitychange", visibility)
        network?.removeEventListener("change", listener)
      }
    },
    log: (message) => console.info(`[${name}] ${message}`),
  }
}
