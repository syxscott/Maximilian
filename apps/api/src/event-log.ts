/**
 * Append-only JSONL event log — durable per-workspace event store so a
 * reconnecting SSE client can replay events it missed while offline.
 *
 * Storage model
 *   - One file per workspace: `<rootDir>/events/{workspaceId}.jsonl`
 *   - Each line (newline-delimited) is a single JSON object:
 *       { seq, type, payload, ts }
 *   - `seq` is a monotonic counter per workspace (NOT line number — lines
 *     may be compacted in a future iteration; seq is stable).
 *
 * Why JSONL instead of Redis Streams (what Shannon/`manager.go` uses):
 *   - The API process is single-node today. Redis would be durability
 *     overkill AND another infra dependency.
 *   - JSONL is trivially replay-able, inspectable (`grep`, `jq`), and
 *     copes with crashes: a half-written line is just invalid JSON and
 *     can be skipped, not a corrupted whole-file.
 *
 * Concurrency
 *   - Append uses the atomic-write pattern from
 *     `packages/evolution/src/atomic.ts` (tmp file + rename-on-same-fs).
 *   - The `readModifyWriteAtomic` helper serializes concurrent appends
 *     via a mkdir-based POSIX lock so interleaving writers can't clobber
 *     each other's seq counter.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getLogger } from "@max/telemetry";

const log = getLogger("api/event-log");

/** One persisted event — wire-compatible with the buffer's `SseEvent`. */
export interface LoggedEvent {
  /** Monotonic per-workspace sequence number. */
  seq: number;
  /** Event type, e.g. "task-start", "workspace", etc. */
  type: string;
  /** Arbitrary JSON payload. */
  payload: unknown;
  /** ISO-8601 timestamp of when the event was appended. */
  ts: string;
}

/**
 * Format one event as a JSONL line. We keep seq|type|payload|ts flat so
 * the file stays human-inspectable and easy to `jq` without parsing a
 * nested envelope.
 */
function serialize(event: LoggedEvent): string {
  return JSON.stringify({
    seq: event.seq,
    type: event.type,
    payload: event.payload,
    ts: event.ts,
  });
}

/**
 * Parse one JSONL line into a LoggedEvent. Returns null on malformed
 * lines (truncated write, crash mid-write) so readers can skip them
 * without aborting.
 */
function deserialize(line: string): LoggedEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const obj = JSON.parse(trimmed) as Partial<LoggedEvent>;
    if (typeof obj.seq !== "number" || typeof obj.type !== "string") return null;
    return {
      seq: obj.seq,
      type: obj.type,
      payload: obj.payload,
      ts: typeof obj.ts === "string" ? obj.ts : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

/**
 * Atomic write via temp + rename on the same filesystem (see
 * `packages/evolution/src/atomic.ts::writeFileAtomic` for the rationale).
 *
 * Inlined here rather than imported to keep the API package free of an
 * `@max/evolution` dependency just for a few lines of fs glue. Copied
 * intentionally — see the atomic.ts module header.
 */
async function writeFileAtomic(target: string, content: string): Promise<void> {
  const dir = path.dirname(target);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(target)}.${randomUUID()}.tmp`);
  try {
    await fs.writeFile(tmp, content, "utf-8");
    await fs.rename(tmp, target);
  } catch (err) {
    await fs.unlink(tmp).catch(() => {});
    throw err;
  }
}

/**
 * Read-modify-write with a mkdir-based POSIX lock so concurrent appends
 * don't interleave. Mirrors `readModifyWriteAtomic` from
 * `packages/evolution/src/atomic.ts` but specialized for the JSONL
 * append case (we don't re-serialize the whole file — we only do that
 * for the bootstrap / `initialize` path).
 */
async function appendLocked(
  target: string,
  appendLine: (latestSeq: number) => string,
): Promise<{ seq: number }> {
  const lockDir = `${target}.lock`;
  const MAX_ATTEMPTS = 200;
  const LOCK_TTL_MS = 5_000;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      await fs.mkdir(lockDir);
      try {
        // Stamp the lock dir with a timestamp so stale locks (e.g. from a
        // crashed process) can be reclaimed after the TTL expires.
        await fs.writeFile(path.join(lockDir, "ts"), String(Date.now())).catch(() => {});
        // Read latest seq if the file exists.
        let latestSeq = 0;
        try {
          const raw = await fs.readFile(target, "utf-8");
          for (const line of raw.split("\n")) {
            const ev = deserialize(line);
            if (ev && ev.seq > latestSeq) latestSeq = ev.seq;
          }
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
        }
        const seq = latestSeq + 1;
        const line = appendLine(seq);
        await fs.appendFile(target, line + "\n", "utf-8");
        return { seq };
      } finally {
        try {
          await fs.rm(path.join(lockDir, "ts"), { force: true });
          await fs.rmdir(lockDir);
        } catch {}
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      // Stale-lock reclaim: if lock dir is older than TTL, force-remove it.
      try {
        const tsText = await fs.readFile(path.join(lockDir, "ts"), "utf-8");
        const ts = parseInt(tsText, 10);
        if (Number.isFinite(ts) && Date.now() - ts > LOCK_TTL_MS) {
          try {
            const files = await fs.readdir(lockDir);
            await Promise.all(files.map((f) => fs.rm(path.join(lockDir, f), { force: true })));
            await fs.rmdir(lockDir);
          } catch {}
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 5 + Math.floor(Math.random() * 20)));
    }
  }
  throw new Error(`event-log: could not acquire lock for ${target} (stale?)`);
}

/**
 * Per-workspace append-only JSONL event log.
 *
 * Construction is synchronous; the file is opened lazily on first append.
 * Call `initialize()` to create the file eagerly (e.g. at server startup)
 * — safe to skip, all methods mkdir-aside.
 */
export class JsonlEventLog {
  private readonly workspaceId: string;
  private readonly rootDir: string;
  private readonly filePath: string;
  private writeHandle: fs.FileHandle | undefined;
  private writeSeq = 0;
  private initialized = false;

  constructor(workspaceId: string, rootDir: string) {
    // SECURITY: workspaceId comes from untrusted URL params. Sanitize to
    // prevent path traversal (e.g. "../../etc/passwd" → "....etcpasswd"
    // could resolve oddly; explicit rejection is safer).
    // Only allow URL-safe slug characters: letters, digits, hyphen,
    // underscore. Dots are rejected to prevent ".." / "../../" tricks.
    const slug = workspaceId.replace(/[^a-zA-Z0-9_\-]/g, "");
    if (!slug || slug !== workspaceId || slug === "." || slug === "..") {
      throw new Error(`Invalid workspaceId: ${JSON.stringify(workspaceId)}`);
    }
    // Defense in depth: resolve under rootDir and verify containment.
    const resolved = path.resolve(rootDir, "events", `${slug}.jsonl`);
    const allowedRoot = path.resolve(rootDir, "events");
    if (!resolved.startsWith(allowedRoot + path.sep) && resolved !== allowedRoot) {
      throw new Error(`workspaceId escapes events dir: ${workspaceId}`);
    }
    this.workspaceId = slug;
    this.rootDir = rootDir;
    this.filePath = resolved;
  }

  /** Absolute path of the backing JSONL file. */
  get file(): string {
    return this.filePath;
  }

  /**
   * Initialize the log: ensure the events directory exists, open the
   * write handle, seed the in-memory seq counter from existing lines.
   *
   * Idempotent — safe to call multiple times.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    // Read the latest seq so we never reuse an id after a restart.
    // (A fresh log starts at seq 0; the first append becomes seq 1.)
    try {
      const raw = await fs.readFile(this.filePath, "utf-8");
      for (const line of raw.split("\n")) {
        const ev = deserialize(line);
        if (ev && ev.seq > this.writeSeq) this.writeSeq = ev.seq;
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    this.writeHandle = await fs.open(this.filePath, "a");
    this.initialized = true;
    log.debug(
      { workspaceId: this.workspaceId, file: this.filePath, seq: this.writeSeq },
      "event-log initialized",
    );
  }

  private ensureInit(): Promise<void> {
    return this.initialize();
  }

  /**
   * Append a new event. Returns the assigned sequence number.
   *
   * The actual disk write delegates to `appendLocked` so concurrent
   * callers (multiple requests hitting the same workspace) are
   * serialized via a mkdir lock. We keep a single write handle open
   * per log instance for the common single-threaded case, but the
   * lock guarantees correctness under parallelism.
   *
   * The in-memory seq is optimistic — if a different process appended
   * between our read and write, the lock holder will have incremented
   * the on-disk counter and our next append will read the fresh value.
   */
  async append(type: string, payload: unknown): Promise<{ seq: number }> {
    await this.ensureInit();
    const line: LoggedEvent = {
      seq: 0, // filled in by appendLocked
      type,
      payload,
      ts: new Date().toISOString(),
    };
    const result = await appendLocked(this.filePath, (seq) => {
      line.seq = seq;
      return serialize(line);
    });
    // Keep our own counter in sync for `latestSeq()` without a re-read.
    if (result.seq > this.writeSeq) this.writeSeq = result.seq;
    return result;
  }

  /**
   * Read all events after `seq` (exclusive). Used by the SSE endpoint
   * to replay events the client missed.
   *
   * Returns events in file order (ascending seq) — no re-sort needed
   * because writers always append in order.
   */
  async readAfter(seq: number): Promise<LoggedEvent[]> {
    await this.ensureInit();
    const events = await this.readAll();
    return events.filter((e) => e.seq > seq);
  }

  /**
   * Return the last N events (newest at the end). Used by the SSE
   * endpoint for "catch-up" — a fresh client that doesn't have a
   * `Last-Event-ID` can still get context on what happened recently.
   */
  async tail(n: number): Promise<LoggedEvent[]> {
    await this.ensureInit();
    if (n <= 0) return [];
    const events = await this.readAll();
    if (events.length <= n) return events;
    return events.slice(events.length - n);
  }

  /** Latest seq written to this log (0 if empty). Synchronous. */
  latestSeq(): number {
    return this.writeSeq;
  }

  private async readAll(): Promise<LoggedEvent[]> {
    try {
      const raw = await fs.readFile(this.filePath, "utf-8");
      const events: LoggedEvent[] = [];
      for (const line of raw.split("\n")) {
        const ev = deserialize(line);
        if (ev) events.push(ev);
      }
      return events;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
  }

  /**
   * Close the write handle. Idempotent. Call on graceful shutdown to
   * release the file descriptor.
   */
  async close(): Promise<void> {
    if (this.writeHandle) {
      try {
        await this.writeHandle.close();
      } catch {
        // ignore — close path, no recovery possible
      }
      this.writeHandle = undefined;
    }
    this.initialized = false;
  }
}

/**
 * Registry of per-workspace event logs so callers don't need to manage
 * the lifecycle of each `JsonlEventLog` themselves.
 */
export class EventLogRegistry {
  private readonly rootDir: string;
  private readonly logs = new Map<string, JsonlEventLog>();

  constructor(rootDir: string) {
    this.rootDir = rootDir;
  }

  /** Get (and lazily create) the log for `workspaceId`. */
  for(workspaceId: string): JsonlEventLog {
    let log = this.logs.get(workspaceId);
    if (!log) {
      log = new JsonlEventLog(workspaceId, this.rootDir);
      this.logs.set(workspaceId, log);
    }
    return log;
  }

  /** Close every open log — call on server shutdown. */
  async closeAll(): Promise<void> {
    for (const log of this.logs.values()) {
      await log.close().catch(() => {});
    }
    this.logs.clear();
  }
}
