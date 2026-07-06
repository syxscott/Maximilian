/**
 * EventBus — typed pub/sub with filtering (借鉴 Kosmos event_bus.py).
 *
 * Kosmos's EventBus exposes:
 *   - subscribe(callback, event_types, process_ids) for filtered subscription
 *   - publish() async + publish_sync() for emission
 *   - EventSubscription context manager for auto-unsubscribe
 *
 * Maximilian adapts this as a generic typed pub/sub that supplements the
 * existing `runtime.on(listener)` collection API. Key benefits:
 *   - Filter by event_type (vs. broad listener)
 *   - Filter by namespace (e.g. process_id / workspace_id)
 *   - Subscription handle exposes `unsubscribe()` for explicit teardown
 *   - Sync + async dispatch with per-subscriber error isolation
 */

export type EventFilter<E extends { type: string }> = {
  /** Whitelist of event types; undefined = all. */
  types?: ReadonlyArray<E["type"]>
  /** Optional namespace predicate; only dispatch events matching. */
  namespace?: (event: E) => string | undefined
  /** Only dispatch events whose namespace is in this list (if namespace() is set). */
  namespaces?: ReadonlyArray<string>
}

export type EventCallback<E> = (event: E) => void | Promise<void>

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
      unsubscribe: () => { this.subscribers.delete(id) },
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
          (ret as Promise<void>).catch((err) => {
            // eslint-disable-next-line no-console
            console.error("[EventBus] async subscriber error:", err)
          })
        }
      } catch (err) {
        // eslint-disable-next-line no-console
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
        try { await sub.callback(event) } catch (err) {
          // eslint-disable-next-line no-console
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