/**
 * Event Sourcing — append-only event log (opencode SessionProjector pattern).
 *
 * All state mutations are recorded as immutable events. Current state is
 * derived by replaying the event log. This gives us:
 *   - Full audit trail
 *   - Time-travel debugging
 *   - Undo/redo capability
 *   - Event-driven projections (read models)
 *
 * Usage:
 *   const store = new EventStore()
 *   store.append({ type: "workspace-created", workspaceId: "ws-1", data: {...} })
 *   store.append({ type: "task-completed", workspaceId: "ws-1", taskId: "t1", data: {...} })
 *   const events = store.getEvents("ws-1")
 *   const state = store.project("ws-1", workspaceReducer)
 */

export interface StoredEvent<T = unknown> {
  /** Unique event id. */
  id: string
  /** Event type discriminator. */
  type: string
  /** Aggregate/workspace this event belongs to. */
  aggregateId: string
  /** Event payload. */
  data: T
  /** Timestamp (ISO 8601). */
  timestamp: string
  /** Monotonic sequence number within the aggregate. */
  seq: number
}

export type EventReducer<S, T = unknown> = (state: S, event: StoredEvent<T>) => S

export interface EventStoreOptions {
  /** Max events per aggregate (oldest are pruned). Default: 1000. */
  maxEventsPerAggregate?: number
}

export class EventStore {
  private events = new Map<string, StoredEvent[]>()
  private seqCounters = new Map<string, number>()
  private maxEvents: number

  constructor(options?: EventStoreOptions) {
    this.maxEvents = options?.maxEventsPerAggregate ?? 1000
  }

  /** Append an event to an aggregate's log. Returns the stored event with id/seq/timestamp. */
  append<T>(params: { type: string; aggregateId: string; data: T }): StoredEvent<T> {
    const { type, aggregateId, data } = params
    const seq = (this.seqCounters.get(aggregateId) ?? 0) + 1
    this.seqCounters.set(aggregateId, seq)

    const event: StoredEvent<T> = {
      id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type,
      aggregateId,
      data,
      timestamp: new Date().toISOString(),
      seq,
    }

    let log = this.events.get(aggregateId)
    if (!log) {
      log = []
      this.events.set(aggregateId, log)
    }
    log.push(event as StoredEvent)

    // Prune if over limit
    if (log.length > this.maxEvents) {
      log.splice(0, log.length - this.maxEvents)
    }

    return event
  }

  /** Get all events for an aggregate, optionally starting from a sequence number. */
  getEvents(aggregateId: string, fromSeq?: number): StoredEvent[] {
    const log = this.events.get(aggregateId) ?? []
    if (fromSeq === undefined) return [...log]
    return log.filter((e) => e.seq >= fromSeq)
  }

  /** Get the latest sequence number for an aggregate. */
  getLatestSeq(aggregateId: string): number {
    return this.seqCounters.get(aggregateId) ?? 0
  }

  /**
   * Project current state by replaying events through a reducer.
   * The reducer receives the current state and each event, returning the new state.
   */
  project<S>(aggregateId: string, reducer: EventReducer<S>, initialState: S): S {
    const events = this.getEvents(aggregateId)
    return events.reduce(reducer, initialState)
  }

  /** Get all aggregate ids that have events. */
  getAggregateIds(): string[] {
    return [...this.events.keys()]
  }

  /** Clear all events (for testing). */
  clear(): void {
    this.events.clear()
    this.seqCounters.clear()
  }

  /** Total event count across all aggregates. */
  get size(): number {
    let total = 0
    for (const log of this.events.values()) total += log.length
    return total
  }
}

// ── Built-in event types ──

export type WorkspaceEvent =
  | StoredEvent<{ status: string }>
  | StoredEvent<{ taskId: string; result: unknown }>
  | StoredEvent<{ taskId: string; error: string }>
  | StoredEvent<{ plan: unknown }>

/** Example reducer: derive workspace status from events. */
export function workspaceStatusReducer(
  state: { status: string; completedTasks: number; failedTasks: number },
  event: StoredEvent,
): { status: string; completedTasks: number; failedTasks: number } {
  switch (event.type) {
    case "workspace-created":
      return { ...state, status: "executing" }
    case "task-completed":
      return { ...state, completedTasks: state.completedTasks + 1 }
    case "task-failed":
      return { ...state, failedTasks: state.failedTasks + 1 }
    case "workspace-completed":
      return { ...state, status: "completed" }
    case "workspace-failed":
      return { ...state, status: "failed" }
    default:
      return state
  }
}
