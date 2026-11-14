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
 *   - Appends serialize via a mkdir-based POSIX lock so interleaving
 *     writers can't clobber each other's seq counter.
 *
 * Torn-tail protection (borrowing mcode-agent-table b00862b, src/store.ts):
 *   - A crash or a full disk can interrupt an append and leave a partial
 *     JSONL line. A blind append at EOF would glue the next entry onto
 *     that fragment, leaving one line no reader can parse — deserialize
 *     would silently skip it and sse-replay would lose the event.
 *   - load and append share ONE tail classifier (classifyLogTail):
 *     what follows the final newline is either nothing ("empty"), a whole
 *     entry that only lost its newline ("complete"), or a fragment of an
 *     interrupted write ("partial"). The cut is a BYTE offset, not a
 *     string offset: a torn write can end inside a multi-byte character,
 *     and decoding first would replace that byte with U+FFFD and shift
 *     every length after it.
 *   - At load, a "complete" tail is applied (it counts into the seq
 *     counter) and the file is terminated with "\n"; a "partial" tail is
 *     truncated away. Anything before the tail keeps the tolerant
 *     per-line skip this log has always had (interior garbage is skipped,
 *     not fatal — the tail is where torn writes live).
 *   - At append, the file is opened once with 'a+' so the repair and the
 *     write share a single file description. A "partial" tail is cut off
 *     through the same fd before the new entry goes down; a "complete"
 *     tail this process never applied is REFUSED (appending after it
 *     would let the in-memory seq state and the ledger disagree forever
 *     — restart to replay). Writes loop until the entry is fully down
 *     (writeSync may write short), and a failed write is rolled back
 *     with ftruncateSync to where the call started.
 */

import { promises as fs } from "node:fs"
import { closeSync, fstatSync, ftruncateSync, openSync, readSync, writeSync } from "node:fs"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { getLogger } from "@max/telemetry"

const log = getLogger("api/event-log")

/** One persisted event — wire-compatible with the buffer's `SseEvent`. */
export interface LoggedEvent {
  /** Monotonic per-workspace sequence number. */
  seq: number
  /** Event type, e.g. "task-start", "workspace", etc. */
  type: string
  /** Arbitrary JSON payload. */
  payload: unknown
  /** ISO-8601 timestamp of when the event was appended. */
  ts: string
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
  })
}

/**
 * Parse one JSONL line into a LoggedEvent. Returns null on malformed
 * lines (truncated write, crash mid-write) so readers can skip them
 * without aborting.
 */
function deserialize(line: string): LoggedEvent | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  try {
    const obj = JSON.parse(trimmed) as Partial<LoggedEvent>
    if (typeof obj.seq !== "number" || typeof obj.type !== "string") return null
    return {
      seq: obj.seq,
      type: obj.type,
      payload: obj.payload,
      ts: typeof obj.ts === "string" ? obj.ts : new Date().toISOString(),
    }
  } catch {
    return null
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
  const dir = path.dirname(target)
  await fs.mkdir(dir, { recursive: true })
  const tmp = path.join(dir, `.${path.basename(target)}.${randomUUID()}.tmp`)
  try {
    await fs.writeFile(tmp, content, "utf-8")
    await fs.rename(tmp, target)
  } catch (err) {
    await fs.unlink(tmp).catch(() => {})
    throw err
  }
}

/**
 * (borrowing mcode-agent-table classifyTail) What follows the final
 * newline of a log: nothing, a whole entry that only lost its newline,
 * or a fragment of an interrupted write. load and append share this one
 * rule, so the two cannot drift apart.
 *
 * Byte-level on purpose: `cut` is a byte offset into the buffer. A torn
 * write can end inside a multi-byte UTF-8 character; decoding the whole
 * buffer first would replace that byte with U+FFFD and shift every
 * length after it.
 */
interface LogTailClassification {
  /** Byte offset just past the final newline (0 when the file has none). */
  cut: number
  state: "empty" | "complete" | "partial"
  /** Parsed entry when state === "complete" (validated via deserialize). */
  entry?: LoggedEvent
}

export function classifyLogTail(buf: Buffer): LogTailClassification {
  const cut = buf.lastIndexOf(0x0a) + 1
  const tail = buf.subarray(cut)
  if (!tail.length) return { cut, state: "empty" }
  const entry = deserialize(tail.toString("utf8"))
  if (entry) return { cut, state: "complete", entry }
  return { cut, state: "partial" }
}

export interface LogBufferScan {
  /** Max seq over every parseable line INCLUDING a complete tail entry. */
  latestSeq: number
  tail: LogTailClassification
}

/**
 * One scan of a log buffer shared by the load side (initialize) and the
 * append side (appendLocked): interior lines are parsed tolerantly
 * (malformed interior lines are skipped — the tail is where torn writes
 * live), the tail goes through the shared classifier.
 */
export function scanLogBuffer(buf: Buffer): LogBufferScan {
  const tail = classifyLogTail(buf)
  let latestSeq = 0
  for (const line of buf.subarray(0, tail.cut).toString("utf8").split("\n")) {
    const ev = deserialize(line)
    if (ev && ev.seq > latestSeq) latestSeq = ev.seq
  }
  if (tail.state === "complete" && tail.entry && tail.entry.seq > latestSeq) {
    latestSeq = tail.entry.seq
  }
  return { latestSeq, tail }
}

/** The whole entry is on disk but this process never applied it. */
export class UnappliedTailError extends Error {
  constructor() {
    super(
      "event-log: the log ends in a complete entry this process has not applied; " +
        "restart to replay the log before appending again",
    )
    this.name = "UnappliedTailError"
  }
}

/**
 * Read-modify-write with a mkdir-based POSIX lock so concurrent appends
 * don't interleave.
 *
 * (borrowing mcode-agent-table appendEntry/appendTo) The critical
 * section is fully synchronous and runs on a single 'a+' file
 * description: repair the torn tail (or refuse an unapplied complete
 * one), then write the entry with a writeSync loop; a failed write is
 * rolled back with ftruncateSync so the next append never finds a
 * fragment of this one.
 */
async function appendLocked(
  target: string,
  opts: { currentWriteSeq: number; appendLine: (latestSeq: number) => string },
): Promise<{ seq: number }> {
  const lockDir = `${target}.lock`
  const MAX_ATTEMPTS = 200
  const LOCK_TTL_MS = 5_000
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      await fs.mkdir(lockDir)
      try {
        // Stamp the lock dir with a timestamp so stale locks (e.g. from a
        // crashed process) can be reclaimed after the TTL expires.
        await fs.writeFile(path.join(lockDir, "ts"), String(Date.now())).catch(() => {})
        const seq = appendWithFd(target, opts)
        return { seq }
      } finally {
        try {
          await fs.rm(path.join(lockDir, "ts"), { force: true })
          await fs.rmdir(lockDir)
        } catch {}
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err
      // Stale-lock reclaim: if lock dir is older than TTL, force-remove it.
      try {
        const tsText = await fs.readFile(path.join(lockDir, "ts"), "utf-8")
        const ts = parseInt(tsText, 10)
        if (Number.isFinite(ts) && Date.now() - ts > LOCK_TTL_MS) {
          try {
            const files = await fs.readdir(lockDir)
            await Promise.all(files.map((f) => fs.rm(path.join(lockDir, f), { force: true })))
            await fs.rmdir(lockDir)
          } catch {}
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 5 + Math.floor(Math.random() * 20)))
    }
  }
  throw new Error(`event-log: could not acquire lock for ${target} (stale?)`)
}

/**
 * The append itself, on a single open description ('a+' = O_APPEND,
 * created when missing). A log that does not end on a newline is
 * repaired first: a fragment is cut off, because the new entry must not
 * be glued onto it, while a whole entry this process never applied is
 * refused, because appending after it would let the in-memory seq state
 * and the ledger disagree forever.
 */
function appendWithFd(
  target: string,
  opts: { currentWriteSeq: number; appendLine: (latestSeq: number) => string },
): number {
  const fd = openSync(target, "a+")
  let failure: unknown
  try {
    return appendToFd(fd, target, opts)
  } catch (err) {
    failure = err
    throw err
  } finally {
    // A close failure must not replace the error that made the append fail.
    try {
      closeSync(fd)
    } catch (err) {
      if (failure === undefined) throw err
    }
  }
}

function appendToFd(
  fd: number,
  target: string,
  opts: { currentWriteSeq: number; appendLine: (latestSeq: number) => string },
): number {
  const size = fstatSync(fd).size
  let from = size // where this append started, so a failed write can be rolled back
  let linePrefix = ""
  if (size > 0) {
    const { latestSeq, tail } = scanLogBuffer(readAllFromFd(fd, size))
    if (tail.state === "complete") {
      if (tail.entry && tail.entry.seq > opts.currentWriteSeq) {
        // The bytes of a whole entry are on disk but this process never
        // applied them. Refuse until a restart replays the log. No path
        // in this message: it can reach API clients.
        throw new UnappliedTailError()
      }
      // Applied complete tail (defensive path): keep the entry, terminate
      // the file with a leading newline before the new line goes down.
      linePrefix = "\n"
    } else if (tail.state === "partial") {
      ftruncateSync(fd, tail.cut)
      log.warn({ file: target, cut: tail.cut }, "event-log: dropped an incomplete trailing line")
      from = tail.cut
    }
    const seq = latestSeq + 1
    const line = opts.appendLine(seq)
    const data = Buffer.from(linePrefix + line + "\n", "utf8")
    try {
      writeAllToFd(fd, data)
    } catch (err) {
      // Roll back to where this call started: a failed append must leave
      // no bytes behind, or the next append would find a fragment of
      // this one.
      try {
        ftruncateSync(fd, from)
      } catch {
        // Keep the original error.
      }
      throw err
    }
    return seq
  }
  // Empty (or missing) file — nothing to repair.
  const seq = 1
  writeAllToFd(fd, Buffer.from(opts.appendLine(seq) + "\n", "utf8"))
  return seq
}

/** writeSync may write fewer bytes than asked for; keep going until done. */
function writeAllToFd(fd: number, data: Buffer): void {
  let off = 0
  while (off < data.length) {
    const n = writeSync(fd, data, off, data.length - off)
    if (n <= 0) throw new Error("event-log: append made no progress")
    off += n
  }
}

/** Read the whole file through the open description, so the repair needs no second open. */
function readAllFromFd(fd: number, size: number): Buffer {
  const buf = Buffer.alloc(size)
  let read = 0
  while (read < size) {
    const n = readSync(fd, buf, read, size - read, read)
    if (n <= 0) break
    read += n
  }
  return buf.subarray(0, read)
}

/**
 * Per-workspace append-only JSONL event log.
 *
 * Construction is synchronous; the file is opened lazily on first append.
 * Call `initialize()` to create the file eagerly (e.g. at server startup)
 * — safe to skip, all methods mkdir-aside.
 */
export class JsonlEventLog {
  private readonly workspaceId: string
  private readonly rootDir: string
  private readonly filePath: string
  private writeHandle: fs.FileHandle | undefined
  private writeSeq = 0
  private initialized = false

  constructor(workspaceId: string, rootDir: string) {
    // SECURITY: workspaceId comes from untrusted URL params. Sanitize to
    // prevent path traversal (e.g. "../../etc/passwd" → "....etcpasswd"
    // could resolve oddly; explicit rejection is safer).
    // Only allow URL-safe slug characters: letters, digits, hyphen,
    // underscore. Dots are rejected to prevent ".." / "../../" tricks.
    const slug = workspaceId.replace(/[^a-zA-Z0-9_\-]/g, "")
    if (!slug || slug !== workspaceId || slug === "." || slug === "..") {
      throw new Error(`Invalid workspaceId: ${JSON.stringify(workspaceId)}`)
    }
    // Defense in depth: resolve under rootDir and verify containment.
    const resolved = path.resolve(rootDir, "events", `${slug}.jsonl`)
    const allowedRoot = path.resolve(rootDir, "events")
    if (!resolved.startsWith(allowedRoot + path.sep) && resolved !== allowedRoot) {
      throw new Error(`workspaceId escapes events dir: ${workspaceId}`)
    }
    this.workspaceId = slug
    this.rootDir = rootDir
    this.filePath = resolved
  }

  /** Absolute path of the backing JSONL file. */
  get file(): string {
    return this.filePath
  }

  /**
   * Initialize the log: ensure the events directory exists, open the
   * write handle, seed the in-memory seq counter from existing lines.
   *
   * (borrowing mcode-agent-table readLedger) The seq scan goes through
   * the shared tail classifier: a "complete" tail entry is APPLIED by
   * this replay (it counts into writeSeq) and the file is terminated
   * with "\n"; if the terminate fails the entry is not durably part of
   * the log, so it is cut off on both sides. A "partial" tail is a torn
   * write — truncated away with a warning. This is the replay point a
   * refused append points at.
   *
   * Idempotent — safe to call multiple times.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return
    await fs.mkdir(path.dirname(this.filePath), { recursive: true })
    // Read the latest seq so we never reuse an id after a restart.
    // (A fresh log starts at seq 0; the first append becomes seq 1.)
    try {
      const raw = await fs.readFile(this.filePath) // Buffer — byte-level tail handling
      const { latestSeq, tail } = scanLogBuffer(raw)
      this.writeSeq = Math.max(this.writeSeq, latestSeq)
      if (tail.state === "complete") {
        try {
          await fs.appendFile(this.filePath, "\n")
        } catch {
          // The entry could not be terminated, so it is not part of the
          // log: drop it on both sides. The seq floor falls back to the
          // interior lines only (the classifier's latestSeq included the
          // dropped tail entry).
          await fs.truncate(this.filePath, tail.cut)
          this.writeSeq = Math.max(
            this.writeSeq,
            scanLogBuffer(raw.subarray(0, tail.cut)).latestSeq,
          )
          log.warn(
            { workspaceId: this.workspaceId, file: this.filePath },
            "event-log: dropped a complete trailing entry that could not be terminated",
          )
        }
      } else if (tail.state === "partial") {
        await fs.truncate(this.filePath, tail.cut)
        log.warn(
          { workspaceId: this.workspaceId, file: this.filePath, cut: tail.cut },
          "event-log: dropped an incomplete trailing line",
        )
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err
    }
    this.writeHandle = await fs.open(this.filePath, "a")
    this.initialized = true
    log.debug(
      { workspaceId: this.workspaceId, file: this.filePath, seq: this.writeSeq },
      "event-log initialized",
    )
  }

  private ensureInit(): Promise<void> {
    return this.initialize()
  }

  /**
   * Append a new event. Returns the assigned sequence number.
   *
   * The actual disk write delegates to `appendLocked`, which serializes
   * concurrent callers via a mkdir lock and performs the torn-tail
   * repair/refusal dance on a single 'a+' file description (see the
   * module header). The in-memory seq handed to the lock is what makes
   * the refusal decision ("complete tail this process never applied")
   * — a fresh instance with writeSeq 0 refuses until initialize()
   * replays the tail.
   *
   * The in-memory seq is optimistic — if a different process appended
   * between our reads, the lock holder re-reads the on-disk counter and
   * our next append sees the fresh value.
   */
  async append(type: string, payload: unknown): Promise<{ seq: number }> {
    await this.ensureInit()
    const line: LoggedEvent = {
      seq: 0, // filled in by appendLocked
      type,
      payload,
      ts: new Date().toISOString(),
    }
    const result = await appendLocked(this.filePath, {
      currentWriteSeq: this.writeSeq,
      appendLine: (seq) => {
        line.seq = seq
        return serialize(line)
      },
    })
    // Keep our own counter in sync for `latestSeq()` without a re-read.
    if (result.seq > this.writeSeq) this.writeSeq = result.seq
    return result
  }

  /**
   * Read all events after `seq` (exclusive). Used by the SSE endpoint
   * to replay events the client missed.
   *
   * Returns events in file order (ascending seq) — no re-sort needed
   * because writers always append in order.
   */
  async readAfter(seq: number): Promise<LoggedEvent[]> {
    await this.ensureInit()
    const events = await this.readAll()
    return events.filter((e) => e.seq > seq)
  }

  /**
   * Return the last N events (newest at the end). Used by the SSE
   * endpoint for "catch-up" — a fresh client that doesn't have a
   * `Last-Event-ID` can still get context on what happened recently.
   */
  async tail(n: number): Promise<LoggedEvent[]> {
    await this.ensureInit()
    if (n <= 0) return []
    const events = await this.readAll()
    if (events.length <= n) return events
    return events.slice(events.length - n)
  }

  /** Latest seq written to this log (0 if empty). Synchronous. */
  latestSeq(): number {
    return this.writeSeq
  }

  /**
   * Read every parseable event in file order. Goes through the shared
   * tail classifier (same rule as initialize/append — the two cannot
   * drift): a complete tail entry is returned, a partial tail fragment
   * is invisible to readers (initialize truncates it away).
   */
  private async readAll(): Promise<LoggedEvent[]> {
    try {
      const raw = await fs.readFile(this.filePath) // Buffer — byte-level tail handling
      const tail = classifyLogTail(raw)
      const events: LoggedEvent[] = []
      for (const line of raw.subarray(0, tail.cut).toString("utf8").split("\n")) {
        const ev = deserialize(line)
        if (ev) events.push(ev)
      }
      if (tail.state === "complete" && tail.entry) events.push(tail.entry)
      return events
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return []
      throw err
    }
  }

  /**
   * Close the write handle. Idempotent. Call on graceful shutdown to
   * release the file descriptor.
   */
  async close(): Promise<void> {
    if (this.writeHandle) {
      try {
        await this.writeHandle.close()
      } catch {
        // ignore — close path, no recovery possible
      }
      this.writeHandle = undefined
    }
    this.initialized = false
  }
}

/**
 * Registry of per-workspace event logs so callers don't need to manage
 * the lifecycle of each `JsonlEventLog` themselves.
 */
export class EventLogRegistry {
  private readonly rootDir: string
  private readonly logs = new Map<string, JsonlEventLog>()

  constructor(rootDir: string) {
    this.rootDir = rootDir
  }

  /** Get (and lazily create) the log for `workspaceId`. */
  for(workspaceId: string): JsonlEventLog {
    let log = this.logs.get(workspaceId)
    if (!log) {
      log = new JsonlEventLog(workspaceId, this.rootDir)
      this.logs.set(workspaceId, log)
    }
    return log
  }

  /** Close every open log — call on server shutdown. */
  async closeAll(): Promise<void> {
    for (const log of this.logs.values()) {
      await log.close().catch(() => {})
    }
    this.logs.clear()
  }
}
