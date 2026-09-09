/**
 * SSE replay buffer — per-workspace ring buffer of recent event payloads
 * so a reconnecting `EventSource` can resume from `Last-Event-ID` instead
 * of dropping events that fired while the client was offline.
 *
 * The browser's `EventSource` automatically tracks the latest `id:` it
 * has seen and sends it back as the `Last-Event-ID` request header on
 * reconnect. We grab that header in the SSE endpoint, find the matching
 * entry in the buffer, and replay everything after it before attaching
 * the live listener.
 *
 * Kept in-process: in a multi-worker deployment each worker keeps its
 * own buffer, so a client that reconnects to a different worker will
 * miss events that fired on the old worker. Acceptable for our scale;
 * if we ever need cross-worker replay we'll move this to Redis.
 */

export interface SseEvent {
  /** Monotonic id within this workspace's stream. */
  id: number
  /** Wire payload — `data:` field of the SSE frame. */
  data: Record<string, unknown>
  /** ISO timestamp for debugging. */
  at: string
}

const DEFAULT_CAPACITY = 64

export class SseReplayBuffer {
  private perWorkspace = new Map<string, { events: SseEvent[]; nextId: number }>()
  private readonly capacity: number
  /**
   * Per-buffer counter that seeds new workspace buckets. Initialized to
   * `Date.now()` so the first id in this process is large enough to
   * dominate any `Last-Event-ID` from before a restart (see #626 — a
   * fresh buffer starting at 1 would make reconnecting clients miss
   * events). Each new workspace bumps the counter, so two workspaces
   * created in the same millisecond still get distinct ids.
   */
  private workspaceSeedCounter: number = Date.now()

  constructor(capacity: number = DEFAULT_CAPACITY) {
    this.capacity = Math.max(1, capacity)
  }

  /**
   * Append an event for `workspaceId` and return the assigned id. Old
   * entries beyond `capacity` are evicted FIFO.
   */
  append(workspaceId: string, data: Record<string, unknown>): SseEvent {
    let bucket = this.perWorkspace.get(workspaceId)
    if (!bucket) {
      bucket = { events: [], nextId: ++this.workspaceSeedCounter }
      this.perWorkspace.set(workspaceId, bucket)
    }
    const event: SseEvent = {
      id: bucket.nextId++,
      data,
      at: new Date().toISOString(),
    }
    bucket.events.push(event)
    if (bucket.events.length > this.capacity) {
      bucket.events.shift()
    }
    return event
  }

  /**
   * Return all events with `id > lastEventId` for `workspaceId`. Empty
   * array if the workspace is unknown or the buffer has nothing newer.
   *
   * If `lastEventId` falls *before* the oldest retained entry, we
   * return everything in the buffer — the client will see a gap but
   * won't be stuck. The runtime's terminal `done` event re-sends the
   * latest workspace snapshot, which is the recovery path.
   */
  since(workspaceId: string, lastEventId: number): SseEvent[] {
    const bucket = this.perWorkspace.get(workspaceId)
    if (!bucket) return []
    return bucket.events.filter((e) => e.id > lastEventId)
  }

  /** Drop all events for a workspace — exposed for tests. */
  clear(workspaceId: string): void {
    this.perWorkspace.delete(workspaceId)
  }

  /** Total buffered events across all workspaces — for /metrics. */
  size(): number {
    let total = 0
    for (const bucket of this.perWorkspace.values()) total += bucket.events.length
    return total
  }
}

/** Parse the `Last-Event-ID` header into a non-negative integer. */
export function parseLastEventId(value: string | undefined | null): number {
  if (!value) return 0
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed < 0) return 0
  return parsed
}

/**
 * Encode an SSE event as a wire frame:
 *
 *   id: 42
 *   data: {"type":"event",...}
 *
 *   (blank line terminates the event)
 */
export function encodeSseFrame(event: SseEvent): string {
  return `id: ${event.id}\ndata: ${JSON.stringify(event.data)}\n\n`
}
