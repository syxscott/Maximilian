// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// (borrowing) Mini-Agent mini_agent/tools/bash_tool.py:52-205 —
// BackgroundShell / BackgroundShellManager ported from asyncio to Node
// child processes. The registry owns every background shell started by
// the `bash` tool with run_in_background=true; `bash_output` reads new
// lines incrementally through a caller-held cursor and `bash_kill`
// terminates and reaps the process.
//
// Retention rule: a shell record survives process exit (status flips to
// "completed"/"failed") so the remaining buffered lines stay readable;
// it is evicted only by the retention cap or an explicit kill+evict.

import { spawn, type ChildProcess } from "node:child_process"
import { randomUUID } from "node:crypto"

/** Lifecycle states, mirroring the Mini-Agent status vocabulary. */
export type BackgroundShellStatus = "running" | "completed" | "failed" | "terminated" | "error"

const DEFAULT_MAX_SHELLS = 16
/** Exited/terminated records kept for post-exit reading before GC. */
const DEFAULT_MAX_RETAINED_EXITED = 32
/** Grace period between SIGTERM and SIGKILL (Mini-Agent terminate()). */
const KILL_GRACE_MS = 5_000
/** Upper bound on retained output lines per shell (1MB-ish budget). */
const MAX_LINES_PER_SHELL = 20_000

export interface BackgroundShellSnapshot {
  readonly bashId: string
  readonly command: string
  readonly cwd: string
  readonly status: BackgroundShellStatus
  readonly exitCode: number | null
  readonly startedAt: number
  readonly totalLines: number
}

interface BackgroundShellRecord {
  readonly bashId: string
  readonly command: string
  readonly cwd: string
  readonly startedAt: number
  readonly proc: ChildProcess
  /** Completed lines collected so far (the live partial line is not here). */
  lines: string[]
  /** Non-newline-terminated bytes seen since the last complete line. */
  pendingPartial: string
  status: BackgroundShellStatus
  exitCode: number | null
  killedByUs: boolean
  /** Resolves when the process reaches a terminal status. */
  exited: Promise<void>
}

export interface StartResult {
  readonly bashId: string
  readonly status: BackgroundShellStatus
}

export type StartFailure = { ok: false; error: string }
export type StartSuccess = { ok: true; bashId: string; status: BackgroundShellStatus }

export interface ReadOptions {
  /**
   * Caller-held cursor: index of the first line NOT yet delivered.
   * Pass the `nextIndex` returned by the previous read.
   */
  lastReadIndex?: number
  /**
   * Optional regex filter. Mirrors the Mini-Agent semantics: only matching
   * lines are returned, but the cursor still advances past every scanned
   * line — non-matching lines are consumed and will not come back.
   * An invalid pattern is ignored (all lines are returned).
   */
  filter?: string
}

export interface ReadResult {
  /** Discriminated success half of the read union. */
  readonly ok: true
  readonly bashId: string
  readonly status: BackgroundShellStatus
  readonly exitCode: number | null
  /** Lines delivered by THIS call (after optional filtering). */
  readonly lines: string[]
  /** New cursor: pass as lastReadIndex on the next call. */
  readonly nextIndex: number
  readonly warnings: string[]
}

export type KillResult =
  | {
      ok: true
      bashId: string
      status: BackgroundShellStatus
      exitCode: number | null
    }
  | { ok: false; error: string }

export interface BackgroundShellRegistryOptions {
  /** Maximum number of live + retained shells. Start is refused beyond this. */
  maxShells?: number
  /** Retention bound for exited records before the oldest are evicted. */
  maxRetainedExited?: number
}

/**
 * Registry of background shells. One process per shell; output is
 * collected line-by-line as the process streams it (the asyncio monitor
 * loop's readline equivalent), so a reader never blocks the writer.
 */
export class BackgroundShellRegistry {
  private readonly shells = new Map<string, BackgroundShellRecord>()
  private readonly maxShells: number
  private readonly maxRetainedExited: number

  constructor(opts?: BackgroundShellRegistryOptions) {
    this.maxShells = Math.max(1, opts?.maxShells ?? DEFAULT_MAX_SHELLS)
    this.maxRetainedExited = Math.max(0, opts?.maxRetainedExited ?? DEFAULT_MAX_RETAINED_EXITED)
  }

  get size(): number {
    return this.shells.size
  }

  /** IDs of every retained shell (running or exited). */
  ids(): string[] {
    return [...this.shells.keys()]
  }

  snapshot(bashId: string): BackgroundShellSnapshot | undefined {
    const record = this.shells.get(bashId)
    if (!record) return undefined
    return {
      bashId: record.bashId,
      command: record.command,
      cwd: record.cwd,
      status: record.status,
      exitCode: record.exitCode,
      startedAt: record.startedAt,
      totalLines: record.lines.length,
    }
  }

  /**
   * Start a command in the background. stdout and stderr are combined
   * into one ordered line stream (Mini-Agent background semantics), so
   * interleaved diagnostics stay in causal order.
   *
   * Enforces the registry cap: starting beyond `maxShells` fails without
   * spawning anything (a leak guard, not a queue).
   */
  start(command: string, cwd: string): StartSuccess | StartFailure {
    if (this.shells.size >= this.maxShells) {
      return {
        ok: false,
        error:
          `background shell registry is full (${this.shells.size}/${this.maxShells}) — ` +
          "read or bash_kill existing shells before starting new ones",
      }
    }
    this.evictOldExited()
    // Second guard after eviction (eviction may have freed nothing).
    if (this.shells.size >= this.maxShells) {
      return {
        ok: false,
        error:
          `background shell registry is full (${this.shells.size}/${this.maxShells}) — ` +
          "read or bash_kill existing shells before starting new ones",
      }
    }

    const shell = defaultShell()
    const proc = spawn(shell, ["-c", command], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    })

    const bashId = randomUUID().slice(0, 8)
    const record: BackgroundShellRecord = {
      bashId,
      command,
      cwd,
      startedAt: Date.now(),
      proc,
      lines: [],
      pendingPartial: "",
      status: "running",
      exitCode: null,
      killedByUs: false,
      exited: new Promise<void>(() => {}),
    }
    this.attachCollectors(record)
    this.shells.set(bashId, record)
    return { ok: true, bashId, status: record.status }
  }

  /**
   * Incremental read from the caller-held cursor. "No overlap, no loss":
   * lines below lastReadIndex are never delivered again; lines above it
   * are delivered once (matching lines when `filter` is set) and the
   * returned nextIndex covers every scanned line.
   */
  read(bashId: string, opts?: ReadOptions): ReadResult | { ok: false; error: string } {
    const record = this.shells.get(bashId)
    if (!record) {
      return {
        ok: false,
        error: `shell not found: ${bashId}. Available: ${this.ids().join(", ") || "none"}`,
      }
    }
    const warnings: string[] = []
    const from = Math.max(0, Math.floor(opts?.lastReadIndex ?? 0))
    // A cursor beyond the buffer (stale/foreign cursor) clamps to the
    // current end so nothing is skipped silently.
    if (from > record.lines.length) {
      warnings.push(
        `last_read_index ${from} is beyond the buffered line count ${record.lines.length} — clamped`,
      )
    }
    const start = Math.min(from, record.lines.length)
    const scanned = record.lines.slice(start)

    let filter: RegExp | undefined
    if (opts?.filter !== undefined && opts.filter !== "") {
      try {
        filter = new RegExp(opts.filter)
      } catch {
        // (borrowing) Mini-Agent get_new_output: an invalid regex falls
        // back to unfiltered delivery instead of dropping everything.
        warnings.push(`invalid filter regex — returning all new lines unfiltered`)
      }
    }
    const delivered = filter ? scanned.filter((line) => filter.test(line)) : scanned

    return {
      ok: true,
      bashId,
      status: record.status,
      exitCode: record.exitCode,
      lines: delivered,
      nextIndex: record.lines.length,
      warnings,
    }
  }

  /**
   * Terminate a shell: SIGTERM first, SIGKILL after the grace period
   * (Mini-Agent terminate()). The record is retained with status
   * "terminated" so buffered output stays readable; the caller can
   * still read the tail via `read` before the retention GC evicts it.
   */
  async kill(bashId: string): Promise<KillResult> {
    const record = this.shells.get(bashId)
    if (!record) {
      return {
        ok: false,
        error: `shell not found: ${bashId}. Available: ${this.ids().join(", ") || "none"}`,
      }
    }
    if (record.status === "running") {
      record.killedByUs = true
      await this.terminateProcess(record)
    }
    // Not running (already exited/terminated): report the recorded state.
    return {
      ok: true,
      bashId,
      status: record.status,
      exitCode: record.exitCode,
    }
  }

  /** Remove a record outright (retention GC / tests). */
  remove(bashId: string): boolean {
    return this.shells.delete(bashId)
  }

  // ── internals ───────────────────────────────────────────────────────────

  /**
   * Wire up the stream collectors and the exit handler. This is the
   * Node equivalent of the Mini-Agent monitor() task: keep reading
   * lines while the process runs, then record the final status.
   */
  private attachCollectors(record: BackgroundShellRecord): void {
    const { proc } = record

    const pushChunk = (chunk: Buffer): void => {
      // Bound retained output: when the line budget is exhausted, drop
      // the OLDEST lines so recent output (the part callers poll for)
      // always wins. The cursor contract stays consistent for readers
      // holding a cursor within the retained window; readers pinned to
      // evicted indices get the clamp warning from read().
      const text = record.pendingPartial + chunk.toString()
      const parts = text.split("\n")
      record.pendingPartial = parts.pop() ?? ""
      for (const line of parts) record.lines.push(line)
      if (record.lines.length > MAX_LINES_PER_SHELL) {
        const overflow = record.lines.length - MAX_LINES_PER_SHELL
        record.lines.splice(0, overflow)
      }
    }

    proc.stdout?.on("data", (chunk: Buffer) => pushChunk(chunk))
    proc.stderr?.on("data", (chunk: Buffer) => pushChunk(chunk))

    record.exited = new Promise<void>((resolve) => {
      proc.on("error", (err) => {
        // Spawn-level failure (e.g. shell binary missing). The close
        // event may never fire; settle the status here.
        if (record.status === "running") {
          record.status = "error"
          record.lines.push(`spawn error: ${err.message}`)
          resolve()
        }
      })
      proc.on("close", (code) => {
        // Flush any trailing partial line so no output is lost.
        if (record.pendingPartial.length > 0) {
          record.lines.push(record.pendingPartial)
          record.pendingPartial = ""
        }
        if (record.status === "running") {
          record.exitCode = code ?? (record.killedByUs ? 143 : 1)
          record.status = record.killedByUs
            ? "terminated"
            : record.exitCode === 0
              ? "completed"
              : "failed"
        }
        resolve()
      })
    })
    // The exit watcher must never hold the event loop open.
    record.exited.catch(() => {})
  }

  /** SIGTERM, then SIGKILL after the grace period (Mini-Agent terminate()). */
  private async terminateProcess(record: BackgroundShellRecord): Promise<void> {
    const { proc } = record
    if (proc.exitCode !== null || proc.signalCode !== null) return
    try {
      proc.kill("SIGTERM")
    } catch {
      // Already dead — the close handler settles the status.
    }
    const timedOut = await this.waitForExit(record, KILL_GRACE_MS)
    if (timedOut) {
      try {
        proc.kill("SIGKILL")
      } catch {
        // Raced with exit — close handler settles.
      }
      await this.waitForExit(record, KILL_GRACE_MS)
    }
    if (record.status === "running") {
      // Close handler may not have run yet (rare); settle defensively.
      record.status = "terminated"
      record.exitCode = proc.exitCode ?? record.exitCode
    }
  }

  /** Resolves true when the wait timed out instead of the process exiting. */
  private async waitForExit(record: BackgroundShellRecord, timeoutMs: number): Promise<boolean> {
    const { proc } = record
    if (proc.exitCode !== null || proc.signalCode !== null) return false
    // The timer is always cleared below, so it never outlives the wait.
    // (Typed as number: the DOM lib overload of setTimeout wins at call
    // sites in this package's lib set, and Node's clearTimeout accepts it.)
    let timer: number | undefined
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(resolve, timeoutMs)
    })
    const result = await Promise.race([record.exited.then(() => "exited" as const), timeout])
    if (timer !== undefined) clearTimeout(timer)
    return result === "timeout"
  }

  /** Evict the oldest exited records when retention overflows. */
  private evictOldExited(): void {
    const exited = [...this.shells.entries()].filter(([, r]) => r.status !== "running")
    const overflow = exited.length - this.maxRetainedExited
    if (overflow <= 0) return
    for (const [id] of exited.slice(0, overflow)) {
      this.shells.delete(id)
    }
  }
}

function defaultShell(): string {
  return process.env.SHELL ?? "/bin/bash"
}

// ── Module singleton ────────────────────────────────────────────────────────

let singleton: BackgroundShellRegistry | undefined

/**
 * Process-wide registry backing the bash/bash_output/bash_kill tool
 * trio (module-level singleton, matching the Mini-Agent class-level
 * `_shells` dict so every tool call sees the same shells).
 */
export function getBackgroundShellRegistry(): BackgroundShellRegistry {
  if (!singleton) singleton = new BackgroundShellRegistry()
  return singleton
}

/** Test seam: replace/reset the singleton. */
export function setBackgroundShellRegistry(registry: BackgroundShellRegistry | undefined): void {
  singleton = registry
}
