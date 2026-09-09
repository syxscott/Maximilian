/**
 * Batched event persistence with backpressure (borrowed from Shannon
 * `internal/streaming/manager.go:125-131`).
 *
 * Background: Shannon's streaming manager buffers events in a channel of
 * capacity `batchSize * 4` and a `persistWorker` flushes every 100ms or
 * when the batch hits `batchSize`. This avoids per-row INSERTs during a
 * burst (e.g. a single task completion emitting 50+ telemetry events).
 *
 * Maximilian's adaptation: a `BatchedPersister<T>` that:
 *   - Accepts `add(item)` from any thread.
 *   - Buffers up to `batchSize` items, then flushes via the supplied
 *     `flush(items)` callback (typically a single batched SQL insert).
 *   - Also flushes on a `flushIntervalMs` timer.
 *   - Tracks dropped items if the buffer overflows (backpressure).
 *
 * The persister has a `dispose()` that flushes pending items and stops
 * the timer. It's safe to call `add()` after `dispose()` — items will
 * just be dropped (logged via console.warn so callers can debug).
 */

export interface BatchedPersisterOptions<T> {
  /** Items per flush. Default: 100. */
  batchSize?: number;
  /** Max buffer before backpressure kicks in. Default: 4 × batchSize. */
  maxBuffer?: number;
  /** Periodic flush interval. Default: 100ms. */
  flushIntervalMs?: number;
  /** Custom flush function. Typically a batched SQL INSERT. */
  flush: (items: T[]) => Promise<void> | void;
  /** Optional label for logging. */
  label?: string;
}

export interface BatchedPersisterStats {
  label: string;
  totalAdded: number;
  totalFlushed: number;
  totalDropped: number;
  totalFlushCalls: number;
  pending: number;
}

export class BatchedPersister<T> {
  private buffer: T[] = [];
  private timer: ReturnType<typeof setInterval> | undefined;
  private disposed = false;
  private flushing = false;

  private totalAdded = 0;
  private totalFlushed = 0;
  private totalDropped = 0;
  private totalFlushCalls = 0;

  private readonly batchSize: number;
  private readonly maxBuffer: number;
  private readonly flushIntervalMs: number;
  readonly label: string;

  constructor(private opts: BatchedPersisterOptions<T>) {
    this.batchSize = opts.batchSize ?? 100;
    this.maxBuffer = opts.maxBuffer ?? this.batchSize * 4;
    this.flushIntervalMs = opts.flushIntervalMs ?? 100;
    this.label = opts.label ?? "default";
  }

  /** Start the periodic flusher. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.flushIntervalMs);
  }

  /** Stop the flusher and flush any pending items. */
  async dispose(): Promise<void> {
    this.disposed = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    await this.flushNow();
  }

  /**
   * Enqueue an item. If the buffer is at capacity, drop the oldest item
   * (and count it). Returns true if accepted, false if dropped.
   */
  add(item: T): boolean {
    if (this.disposed) {
      this.totalDropped += 1;
      return false;
    }
    this.totalAdded += 1;
    if (this.buffer.length >= this.maxBuffer) {
      // Backpressure: drop oldest, accept newest (most-recent-wins).
      this.buffer.shift();
      this.totalDropped += 1;
    }
    this.buffer.push(item);
    if (this.buffer.length >= this.batchSize) {
      void this.tick();
    }
    return true;
  }

  /** Force an immediate flush (synchronously awaited). */
  async flushNow(): Promise<void> {
    if (this.flushing) return;
    await this.tick();
  }

  stats(): BatchedPersisterStats {
    return {
      label: this.label,
      totalAdded: this.totalAdded,
      totalFlushed: this.totalFlushed,
      totalDropped: this.totalDropped,
      totalFlushCalls: this.totalFlushCalls,
      pending: this.buffer.length,
    };
  }

  private async tick(): Promise<void> {
    if (this.flushing) return;
    if (this.buffer.length === 0) return;
    this.flushing = true;
    const items = this.buffer;
    this.buffer = [];
    try {
      await this.opts.flush(items);
      this.totalFlushed += items.length;
    } catch (err) {
      // Persist failed — count dropped so operators see the gap.
      this.totalDropped += items.length;
       
      console.error(`[BatchedPersister:${this.label}] flush failed`, err);
    } finally {
      this.totalFlushCalls += 1;
      this.flushing = false;
    }
  }
}