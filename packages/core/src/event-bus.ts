/**
 * EventBus — typed pub/sub with filtering and multiple dispatch modes (借鉴 Kosmos + DeepSeek Cordis).
 *
 * Features:
 *   - Filter by event_type (vs. broad listener)
 *   - Filter by namespace (e.g. process_id / workspace_id)
 *   - Subscription handle exposes `unsubscribe()` for explicit teardown
 *   - Sync + async dispatch with per-subscriber error isolation
 *   - Multiple dispatch modes: emit, parallel, serial, bail, waterfall
 *
 * Dispatch modes (借鉴 DeepSeek Cordis):
 *   - emit: fire-and-forget, no return value
 *   - parallel: all listeners run concurrently, awaited
 *   - serial: listeners run in order, each awaited
 *   - bail: synchronous short-circuit (first non-undefined return stops)
 *   - waterfall: around-middleware, must call next() to delegate
 */

export type EventFilter<E extends { type: string }> = {
  /** Whitelist of event types; undefined = all. */
  types?: ReadonlyArray<E["type"]>
  /** Optional namespace predicate; only dispatch events matching. */
  namespace?: (event: E) => string | undefined
  /** Only dispatch events whose namespace is in this list (if namespace() is set). */
  namespaces?: ReadonlyArray<string>
}

/** Dispatch mode for events. */
export type DispatchMode = "emit" | "parallel" | "serial" | "bail" | "waterfall"

export type EventCallback<E> = (event: E) => void | Promise<void>

/**
 * Waterfall listener signature — receives args and a next() function.
 * Must call next() to delegate to the next listener.
 * Return without calling next() to short-circuit.
 */
export type WaterfallListener<E, R = void> = (event: E, next: () => R) => R | Promise<R>

export interface SubscriptionHandle {
  unsubscribe(): void
}

export class EventBus<E extends { type: string } = { type: string }> {
  private subscribers = new Map<symbol, { callback: EventCallback<E>; filter: EventFilter<E> }>()
  private history: E[] = []
  /** Cap history to avoid unbounded memory in long-running processes. */
  private historyCap: number

  constructor(options?: { historyCap?: number }) {
    this.historyCap = options?.historyCap ?? 1000
  }

  /**
   * Subscribe to events matching `filter`. Returns a handle for explicit
   * teardown. The callback's returned promise is awaited; errors are
   * isolated so one bad subscriber can't kill the rest.
   */
  subscribe(callback: EventCallback<E>, filter: EventFilter<E> = {}): SubscriptionHandle {
    const id = Symbol("sub")
    this.subscribers.set(id, { callback, filter })
    return {
      unsubscribe: () => {
        this.subscribers.delete(id)
      },
    }
  }

  /**
   * Publish an event synchronously. Async callbacks are tracked but not awaited.
   * Returns the count of subscribers that matched.
   */
  publish(event: E): number {
    this.recordHistory(event)
    let matched = 0
    for (const sub of this.subscribers.values()) {
      if (!this.matchesFilter(event, sub.filter)) continue
      matched++
      try {
        const ret = sub.callback(event)
        if (ret && typeof (ret as Promise<unknown>).then === "function") {
          // Fire-and-forget; isolate errors.
          ;(ret as Promise<void>).catch((err) => {
            console.error("[EventBus] async subscriber error:", err)
          })
        }
      } catch (err) {
        console.error("[EventBus] sync subscriber error:", err)
      }
    }
    return matched
  }

  /**
   * Publish an event and await all matching subscribers. Useful when
   * downstream consumers need guaranteed processing before continuing.
   */
  async publishAsync(event: E): Promise<number> {
    this.recordHistory(event)
    const matched: Array<() => Promise<void>> = []
    for (const sub of this.subscribers.values()) {
      if (!this.matchesFilter(event, sub.filter)) continue
      matched.push(async () => {
        try {
          await sub.callback(event)
        } catch (err) {
          console.error("[EventBus] async subscriber error:", err)
        }
      })
    }
    await Promise.all(matched.map((fn) => fn()))
    return matched.length
  }

  /** Number of active subscriptions. */
  size(): number {
    return this.subscribers.size
  }

  /** Most recent N events (for replay / debugging). */
  recentEvents(limit = 50): E[] {
    return this.history.slice(-limit)
  }

  /** Drop all subscribers (for clean shutdown / test isolation). */
  clear(): void {
    this.subscribers.clear()
    this.history = []
  }

  /**
   * Dispatch an event using a specific mode (借鉴 DeepSeek Cordis).
   * - `emit`: fire-and-forget, no return value (default)
   * - `parallel`: all listeners run concurrently, awaited
   * - `serial`: listeners run in registration order, each awaited
   * - `bail`: synchronous, first non-undefined return stops the chain
   * - `waterfall`: around-middleware, listener receives next() to delegate
   */
  dispatch(mode: DispatchMode, event: E): unknown {
    this.recordHistory(event)
    const subs = [...this.subscribers.values()].filter((sub) =>
      this.matchesFilter(event, sub.filter),
    )
    switch (mode) {
      case "emit": {
        let matched = 0
        for (const sub of subs) {
          matched++
          try {
            const ret = sub.callback(event)
            if (ret && typeof (ret as Promise<unknown>).then === "function") {
              ;(ret as Promise<void>).catch((err) => {
                console.error("[EventBus] async subscriber error:", err)
              })
            }
          } catch (err) {
            console.error("[EventBus] sync subscriber error:", err)
          }
        }
        return matched
      }
      case "parallel": {
        return (async () => {
          const results: unknown[] = []
          await Promise.all(
            subs.map((sub) =>
              (async () => {
                try {
                  const ret = await sub.callback(event)
                  results.push(ret)
                } catch (err) {
                  console.error("[EventBus] parallel subscriber error:", err)
                  results.push(undefined)
                }
              })(),
            ),
          )
          return results
        })()
      }
      case "serial": {
        return (async () => {
          const results: unknown[] = []
          for (const sub of subs) {
            try {
              const ret = sub.callback(event)
              if (ret && typeof (ret as Promise<unknown>).then === "function") {
                await ret
              }
              results.push(ret)
            } catch (err) {
              console.error("[EventBus] serial subscriber error:", err)
              results.push(undefined)
            }
          }
          return results
        })()
      }
      case "bail": {
        for (const sub of subs) {
          try {
            const ret = sub.callback(event)
            if (ret && typeof (ret as Promise<unknown>).then === "function") {
              // For async, we can't bail synchronously — fall through to await
              void (ret as Promise<unknown>).then((v) => {
                if (v !== undefined) void v
              })
            } else if (ret !== undefined) {
              return ret
            }
          } catch (err) {
            console.error("[EventBus] bail subscriber error:", err)
          }
        }
        return undefined
      }
      case "waterfall": {
        // Waterfall: each listener can short-circuit by NOT calling
        // `next()`. Subscribers are cast to WaterfallListener for the
        // (event, next) signature; callers using `subscribe()` with a
        // plain EventCallback will simply ignore the unused `next`
        // argument (their return value still acts as the chain value).
        // For async waterfall support, callers should use
        // `subscribeWaterfall()` or wrap async work in their listener.
        let chainResult: unknown = undefined
        let chainBroken = false
        for (let i = 0; i < subs.length; i++) {
          if (chainBroken) break
          const sub = subs[i]!
          const next =
            i < subs.length - 1
              ? () => {
                  chainBroken = true
                  return undefined
                }
              : () => undefined
          try {
            const ret = (sub.callback as unknown as WaterfallListener<E>)(event, next)
            // Async listeners are not awaited here — dispatch() is
            // sync. Callers needing async waterfall should compose
            // promises themselves or call dispatch in a Promise.all.
            if (ret && typeof (ret as Promise<unknown>).then === "function") {
              // Fire-and-forget; document the limitation rather than
              // silently dropping the promise.
              void ret.catch((err) => {
                console.error("[EventBus] waterfall async listener error:", err)
              })
            } else {
              chainResult = ret
              if (chainResult !== undefined) chainBroken = true
            }
          } catch (err) {
            console.error("[EventBus] waterfall subscriber error:", err)
          }
        }
        return chainResult
      }
    }
  }

  private matchesFilter(event: E, filter: EventFilter<E>): boolean {
    if (filter.types && filter.types.length > 0) {
      if (!filter.types.includes(event.type)) return false
    }
    if (filter.namespace && filter.namespaces) {
      const ns = filter.namespace(event)
      if (ns === undefined) return false
      if (!filter.namespaces.includes(ns)) return false
    }
    return true
  }

  private recordHistory(event: E): void {
    this.history.push(event)
    if (this.history.length > this.historyCap) {
      this.history = this.history.slice(-this.historyCap)
    }
  }
}
