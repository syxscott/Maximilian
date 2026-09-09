/**
 * Hot-reload YAML/JSON config with callback registry (borrowed from
 * Shannon `main.go:184-353` `cfg.NewConfigManager` + `RegisterCallback`).
 *
 * Background: Shannon watches a YAML directory; on change it diffs old
 * vs new, and fires registered callbacks per-key so consumers can
 * selectively re-init subsystems (circuit-breaker thresholds, policy
 * rules, observability settings, etc.) without a process restart.
 *
 * Maximilian's adaptation: a `HotReloadConfig` class that:
 *   - Polls a JSON config file at a configurable interval.
 *   - Diffs the previous snapshot against the new one.
 *   - Fires per-key callbacks (`onChange(key, newValue, oldValue)`).
 *   - Stops polling on `dispose()`.
 *
 * Pure Node — no external deps. JSON only (YAML would need a parser;
 * JSON covers the 95% case without adding a dep).
 */

export type ConfigListener<T = unknown> = (
  key: string,
  newValue: T | undefined,
  oldValue: T | undefined,
) => void | Promise<void>;

export interface HotReloadConfigOptions<T = Record<string, unknown>> {
  /** Initial in-memory snapshot. The file is loaded lazily on first `start()`. */
  initial?: T;
  /** Polling interval. Default: 5000ms. */
  intervalMs?: number;
  /** Custom JSON parser. Default: `JSON.parse`. */
  parse?: (raw: string) => T;
}

export class HotReloadConfig<T = Record<string, unknown>> {
  private snapshot: T | undefined;
  private listeners = new Map<string, Set<ConfigListener>>();
  private globalListeners = new Set<ConfigListener>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private reading = false;

  constructor(
    private filePath: string,
    private opts: HotReloadConfigOptions<T> = {},
  ) {
    this.snapshot = opts.initial;
  }

  /** Start polling for changes. */
  async start(): Promise<void> {
    // Initial load if no snapshot was provided.
    if (this.snapshot === undefined) {
      try {
        this.snapshot = await this.readFile();
      } catch {
        // File missing — start with empty config; we'll retry on next tick.
        this.snapshot = {} as T;
      }
    }
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.opts.intervalMs ?? 5_000);
  }

  /** Stop polling. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /** Subscribe to a specific key. */
  on<K extends keyof T & string>(key: K, listener: ConfigListener<T[K]>): () => void {
    let set = this.listeners.get(key);
    if (!set) {
      set = new Set();
      this.listeners.set(key, set as Set<ConfigListener>);
    }
    set.add(listener as ConfigListener);
    return () => {
      set?.delete(listener as ConfigListener);
    };
  }

  /** Subscribe to every key. */
  onAny(listener: ConfigListener): () => void {
    this.globalListeners.add(listener);
    return () => {
      this.globalListeners.delete(listener);
    };
  }

  /** Current snapshot (last loaded). */
  current(): T | undefined {
    return this.snapshot;
  }

  /** Read a single key with default. */
  get<K extends keyof T & string>(key: K, fallback: T[K]): T[K] {
    const s = this.snapshot;
    if (s === undefined) return fallback;
    const v = (s as Record<string, unknown>)[key];
    return v === undefined ? fallback : (v as T[K]);
  }

  private async tick(): Promise<void> {
    if (this.reading) return;
    this.reading = true;
    try {
      const next = await this.readFile();
      const prev = this.snapshot;
      this.snapshot = next;
      this.diff(prev, next);
    } catch {
      // Read failure: leave snapshot as-is. Could publish a metric.
    } finally {
      this.reading = false;
    }
  }

  private async readFile(): Promise<T> {
    const fs = await import("node:fs/promises");
    const raw = await fs.readFile(this.filePath, "utf-8");
    const parse = this.opts.parse ?? ((s: string) => JSON.parse(s) as T);
    return parse(raw);
  }

  private diff(prev: T | undefined, next: T): void {
    if (prev === undefined) {
      // First read: notify all listeners with their key.
      for (const [k, v] of Object.entries(next as Record<string, unknown>)) {
        this.fire(k, v, undefined);
      }
      return;
    }
    const prevKeys = new Set(Object.keys(prev as Record<string, unknown>));
    const nextKeys = Object.keys(next as Record<string, unknown>);
    for (const k of nextKeys) {
      const oldV = (prev as Record<string, unknown>)[k];
      const newV = (next as Record<string, unknown>)[k];
      if (!deepEqual(oldV, newV)) {
        this.fire(k, newV, oldV);
      }
    }
    for (const k of prevKeys) {
      if (!nextKeys.includes(k)) {
        this.fire(k, undefined, (prev as Record<string, unknown>)[k]);
      }
    }
  }

  private fire(key: string, newValue: unknown, oldValue: unknown): void {
    const set = this.listeners.get(key);
    if (set) {
      for (const listener of set) {
        void Promise.resolve(listener(key, newValue, oldValue));
      }
    }
    for (const listener of this.globalListeners) {
      void Promise.resolve(listener(key, newValue, oldValue));
    }
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (typeof a !== typeof b) return false;
  if (typeof a === "object") {
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const ak = Object.keys(a as Record<string, unknown>);
    const bk = Object.keys(b as Record<string, unknown>);
    if (ak.length !== bk.length) return false;
    for (const k of ak) {
      if (!deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) {
        return false;
      }
    }
    return true;
  }
  return false;
}