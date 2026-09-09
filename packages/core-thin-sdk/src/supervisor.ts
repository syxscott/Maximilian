// supervisor.ts — process supervisor for `opencode serve`.
//
// Wraps `child_process.spawn` with:
//   - ready-signal detection (parses stdout for "listening on http://…:PORT")
//   - automatic crash restart with exponential backoff (1s, 2s, 4s, 8s, max 30s)
//   - bounded retries (`maxRestarts`) that escalate to a `fatal` event
//   - EventEmitter surface (`start`, `ready`, `exit`, `restart`, `error`, `fatal`)
//   - graceful shutdown (SIGTERM → SIGKILL after timeout)
//
// Mirrors the opencode SDK helper `createOpencodeServer`
// (`packages/sdk/js/src/v2/server.ts`) but adds supervision + EventEmitter.

import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import { getLogger } from "@max/telemetry";
import { healthCheck } from "./health.js";

const log = getLogger("core-thin-sdk.supervisor");

/** Default ready-signal timeout in milliseconds. */
const DEFAULT_READY_TIMEOUT_MS = 30_000;
/** Default graceful-shutdown timeout before SIGKILL. */
const DEFAULT_STOP_TIMEOUT_MS = 5000;
/** Default health-check interval in milliseconds. */
const DEFAULT_HEALTH_CHECK_MS = 5_000;

/** Maximum exponential-backoff delay. */
const MAX_BACKOFF_MS = 30_000;

/**
 * Regex used to extract the listening port from a ready signal line.
 * Matches both "Listening on http://…" (spec) and "opencode server listening on http://…"
 * as long as the line ends with a port number.
 */
const READY_PORT_RE = /listening on https?:\/\/[^:\s]+:(\d+)/i;

/** Sanity cap so a misbehaving process can't pin us at e.g. 30s × N forever. */
function backoffDelay(restartCount: number): number {
  // 1s, 2s, 4s, 8s, 16s, capped at 30s.
  const ms = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** restartCount);
  return ms;
}

export interface SupervisorOptions {
  /** argv[0] used to spawn the server, e.g. `["opencode", "serve"]`. */
  command: string[];
  /** Extra args appended after `command`. Default: `[]`. */
  args?: string[];
  /** Environment additions on top of `process.env`. */
  env?: Record<string, string>;
  /** Working directory for the child process. Default: `process.cwd()`. */
  cwd?: string;
  /**
   * Port the server should listen on. If omitted, the port is parsed
   * from the ready-signal stdout line. If neither is available, defaults to 0.
   */
  port?: number;
  /** How often (ms) to call `/api/health`. Default: 5000. Set to 0 to disable. */
  healthCheckMs?: number;
  /** Auto-restart on crash. Default: true. */
  restartOnCrash?: boolean;
  /** Maximum automatic restarts before escalating to `fatal`. Default: 5. */
  maxRestarts?: number;
  /** Maximum time (ms) to wait for the ready signal. Default: 30000. */
  readyTimeoutMs?: number;
  /** Default graceful-shutdown timeout. Default: 5000. */
  stopTimeoutMs?: number;
}

/**
 * Payload emitted with the `ready` event once the supervisor has parsed the
 * listening URL from the child's stdout.
 */
export interface ReadyInfo {
  port: number;
  url: string;
}

export interface SupervisorEvents {
  start: [];
  ready: [ReadyInfo];
  exit: [{ code: number | null; signal: NodeJS.Signals | null }];
  restart: [{ attempt: number; delayMs: number; lastError?: Error }];
  error: [Error];
  fatal: [{ reason: string; lastError?: Error; restarts: number }];
  log: [{ stream: "stdout" | "stderr"; line: string }];
}

/** Initialized lazily so `lazy <port>` accessor can refer back to `this`. */
const _supervisorState = Symbol("supervisorState");
type InternalState = {
  proc: ChildProcess | null;
  readyResolvers: Array<(info: ReadyInfo) => void>;
  readyRejecters: Array<(err: Error) => void>;
  stdoutBuf: string;
  stderrBuf: string;
  parsedPort: number | null;
  startedAt: number | null;
  stopRequested: boolean;
  lastHealthy: boolean;
  healthTimer: NodeJS.Timeout | null;
  readyTimer: NodeJS.Timeout | null;
  stopTimer: NodeJS.Timeout | null;
  pendingStartPromise: Promise<void> | null;
};

export class Supervisor extends EventEmitter {
  private readonly opts: Required<
    Pick<SupervisorOptions, "restartOnCrash" | "maxRestarts" | "readyTimeoutMs" | "stopTimeoutMs" | "healthCheckMs">
  > & SupervisorOptions;

  private [_supervisorState]: InternalState = {
    proc: null,
    readyResolvers: [],
    readyRejecters: [],
    stdoutBuf: "",
    stderrBuf: "",
    parsedPort: null,
    startedAt: null,
    stopRequested: false,
    lastHealthy: false,
    healthTimer: null,
    readyTimer: null,
    stopTimer: null,
    pendingStartPromise: null,
  };

  private _restartCount = 0;
  private _lastError: Error | undefined;

  constructor(opts: SupervisorOptions) {
    super();
    if (!opts.command || opts.command.length === 0) {
      throw new Error("Supervisor: `command` must be a non-empty array");
    }
    this.opts = {
      args: [],
      env: {},
      cwd: process.cwd(),
      restartOnCrash: true,
      maxRestarts: 5,
      readyTimeoutMs: DEFAULT_READY_TIMEOUT_MS,
      stopTimeoutMs: DEFAULT_STOP_TIMEOUT_MS,
      healthCheckMs: DEFAULT_HEALTH_CHECK_MS,
      ...opts,
    };
  }

  // ── public accessors ────────────────────────────────────────────────────

  get port(): Promise<number> {
    return this.waitForPort();
  }

  get baseUrl(): Promise<string> {
    return this.port.then((p) => `http://localhost:${p}`);
  }

  get isHealthy(): Promise<boolean> {
    // Already-healthy fast path.
    const s = this[_supervisorState];
    if (s.lastHealthy) return Promise.resolve(true);
    return this.getBaseUrlThenCheck();
  }

  get restartCount(): number {
    return this._restartCount;
  }

  get uptimeMs(): number {
    const s = this[_supervisorState];
    return s.startedAt ? Date.now() - s.startedAt : 0;
  }

  get lastError(): Error | undefined {
    return this._lastError;
  }

  get running(): boolean {
    return this[_supervisorState].proc !== null;
  }

  // ── public API ─────────────────────────────────────────────────────────

  async start(): Promise<void> {
    const s = this[_supervisorState];
    if (s.pendingStartPromise) return s.pendingStartPromise;
    if (s.proc) {
      // Already running — no-op.
      return;
    }
    s.pendingStartPromise = this._start().finally(() => {
      s.pendingStartPromise = null;
    });
    return s.pendingStartPromise;
  }

  async stop(timeoutMs?: number): Promise<void> {
    const s = this[_supervisorState];
    if (s.stopRequested && !s.proc) return; // already stopped
    s.stopRequested = true;
    this.stopHealthLoop();
    this.clearReadyTimer();

    if (!s.proc) return;

    const proc = s.proc;
    const procAny = proc as unknown as { exitCode: number | null; kill: (sig?: string) => void };
    const grace = timeoutMs ?? this.opts.stopTimeoutMs;

    // If the process has already exited (exitCode set), no signal is needed.
    if (procAny.exitCode !== null) {
      s.proc = null;
      return;
    }

    await new Promise<void>((resolve) => {
      let settled = false;
      const settle = () => {
        if (settled) return;
        settled = true;
        if (s.stopTimer) {
          clearTimeout(s.stopTimer);
          s.stopTimer = null;
        }
        resolve();
      };
      proc.once("exit", () => settle());
      try {
        proc.kill("SIGTERM");
      } catch {
        settle();
        return;
      }
      s.stopTimer = setTimeout(() => {
        // Only escalate if the process is STILL running (exitCode still null).
        // Note: `proc.killed` becomes true after kill() succeeds regardless of
        // whether the OS actually terminated the child, so we don't gate on it.
        try {
          if (procAny.exitCode === null) proc.kill("SIGKILL");
        } catch {
          // best-effort
        }
      }, grace);
    });

    s.proc = null;
    s.parsedPort = null;
  }

  async restart(): Promise<void> {
    await this.stop(this.opts.stopTimeoutMs);
    this._restartCount += 1;
    await this.start();
  }

  // ── internals ──────────────────────────────────────────────────────────

  private async _start(): Promise<void> {
    const s = this[_supervisorState];
    s.stopRequested = false;

    const [program, ...baseCmd] = this.opts.command;
    const allArgs = [...baseCmd, ...(this.opts.args ?? [])];

    if (this.opts.port !== undefined && this.opts.port !== 0) {
      allArgs.push("--port", String(this.opts.port));
    }

    const env = { ...process.env, ...(this.opts.env ?? {}) };
    const spawnOpts: SpawnOptions = {
      cwd: this.opts.cwd,
      env,
      // Treat stdout/stderr as binary Buffers so we preserve any non-UTF8 bytes.
      stdio: ["pipe", "pipe", "pipe"],
    };

    log.info(
      { program, args: allArgs, cwd: spawnOpts.cwd, port: this.opts.port },
      "spawning opencode serve",
    );

    const proc = spawn(program!, allArgs, spawnOpts);
    s.proc = proc;
    s.startedAt = Date.now();
    s.stdoutBuf = "";
    s.stderrBuf = "";

    this.emit("start");
    this.attachStreams(proc);

    // Pre-resolve port from opts if we know it (avoids waiting on stdout).
    if (this.opts.port !== undefined && this.opts.port !== 0) {
      s.parsedPort = this.opts.port;
    }

    const readyInfo = await this.waitForReady(proc);
    this.emit("ready", readyInfo);

    // Start background health loop.
    if (this.opts.healthCheckMs > 0) this.startHealthLoop();
  }

  /** Wire stdout/stderr for parsing + logging. Buffers are binary-safe. */
  private attachStreams(proc: ChildProcess): void {
    const s = this[_supervisorState];
    const pump = (
      stream: NodeJS.ReadableStream | null,
      kind: "stdout" | "stderr",
      bufKey: "stdoutBuf" | "stderrBuf",
    ) => {
      if (!stream) return;
      stream.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf8");
        s[bufKey] += text;
        // Drain line-by-line for both logging and ready-signal detection.
        let nl: number;
        while ((nl = s[bufKey].indexOf("\n")) !== -1) {
          const line = s[bufKey].slice(0, nl).replace(/\r$/, "");
          s[bufKey] = s[bufKey].slice(nl + 1);
          this.emit("log", { stream: kind, line });
          log.debug({ stream: kind, line }, "opencode");
          this.tryParseReady(line);
        }
      });
    };
    pump(proc.stdout, "stdout", "stdoutBuf");
    pump(proc.stderr, "stderr", "stderrBuf");

    proc.on("error", (err: Error) => {
      this.emit("error", err);
      log.error({ err }, "child process error");
    });

    proc.on("exit", (code, signal) => {
      log.info({ code, signal }, "child process exited");
      s.proc = null;
      this.emit("exit", { code, signal });
      this.stopHealthLoop();

      // Resolve any pending ready waiters with the exit code (rare — usually
      // we hit the ready signal first).
      const exitErr = new Error(
        `opencode serve exited before ready (code=${code}, signal=${signal})`,
      );
      for (const rj of s.readyRejecters) rj(exitErr);
      s.readyRejecters = [];
      s.readyResolvers = [];

      if (!s.stopRequested && this.opts.restartOnCrash) {
        void this.scheduleRestart(new Error(`exited code=${code} signal=${signal}`));
      }
    });
  }

  /** Scan a single line for the ready signal. Idempotent. */
  private tryParseReady(line: string): void {
    const s = this[_supervisorState];
    const m = READY_PORT_RE.exec(line);
    if (!m || !m[1]) return;
    const port = Number(m[1]);
    if (!Number.isFinite(port)) return;
    if (s.parsedPort !== null && s.parsedPort !== port) {
      log.warn(
        { old: s.parsedPort, new: port },
        "ready signal changed port; taking the latest",
      );
    }
    s.parsedPort = port;
    const resolvers = s.readyResolvers;
    s.readyResolvers = [];
    for (const r of resolvers) r({ port, url: `http://localhost:${port}` });
  }

  /** Wait for ready signal with timeout. Resolves with `ReadyInfo`. */
  private waitForReady(proc: ChildProcess): Promise<ReadyInfo> {
    const s = this[_supervisorState];
    return new Promise<ReadyInfo>((resolve, reject) => {
      let resolved = false;
      let port = s.parsedPort;
      const url = port !== null ? `http://localhost:${port}` : null;
      const finish = () => {
        if (resolved) return
        resolved = true
        if (s.readyTimer) {
          clearTimeout(s.readyTimer)
          s.readyTimer = null
        }
        if (port === null) {
          reject(new Error("opencode serve: ready signal never received"))
        } else {
          resolve({ port, url: `http://localhost:${port}` })
        }
      }
      // The ready signal can fire (or be preset from opts.port) before the
      // TCP listener is actually accepting connections. Poll the port up to
      // readyTimeoutMs before declaring ready.
      const probePort = async () => {
        if (port === null) return
        const deadline = Date.now() + this.opts.readyTimeoutMs
        while (Date.now() < deadline) {
          const r = await healthCheck(`http://localhost:${port}`, 500).catch(() => null)
          if (r?.ok) {
            finish()
            return
          }
          await new Promise((r) => setTimeout(r, 50))
        }
        // Even if health never came back, fire finish so callers don't hang —
        // the health loop will catch real problems and trigger a restart.
        finish()
      }
      s.readyResolvers.push((info) => {
        port = info.port
        void probePort()
      })
      s.readyRejecters.push((err) => {
        if (resolved) return
        resolved = true
        reject(err)
      })
      const readyTimeout = this.opts.readyTimeoutMs;
      s.readyTimer = setTimeout(() => {
        if (resolved) return
        log.warn({ readyTimeout, port }, "ready signal timed out; forcing finish")
        finish()
      }, readyTimeout)
      // If we already know the port from opts.port, start probing immediately.
      if (port !== null) void probePort()
    })
  }

  /** Wait for ready, then return the port number. */
  private async waitForPort(): Promise<number> {
    const s = this[_supervisorState];
    if (s.parsedPort !== null) return s.parsedPort;
    if (!s.proc) {
      throw new Error("Supervisor: not started; call start() first");
    }
    return new Promise<number>((resolve, reject) => {
      s.readyResolvers.push((info) => resolve(info.port));
      s.readyRejecters.push(reject);
    });
  }

  private async getBaseUrlThenCheck(): Promise<boolean> {
    let base: string;
    try {
      base = await this.baseUrl;
    } catch {
      return false;
    }
    const r = await healthCheck(base, 2000);
    return r.ok;
  }

  private clearReadyTimer(): void {
    const s = this[_supervisorState];
    if (s.readyTimer) {
      clearTimeout(s.readyTimer);
      s.readyTimer = null;
    }
  }

  private startHealthLoop(): void {
    const s = this[_supervisorState];
    this.stopHealthLoop();
    const tick = async () => {
      try {
        const base = await this.baseUrl;
        const r = await healthCheck(base, Math.min(2000, this.opts.healthCheckMs));
        s.lastHealthy = r.ok;
      } catch {
        s.lastHealthy = false;
      }
    };
    // Fire one immediately so the first `isHealthy` reflects current state.
    void tick();
    s.healthTimer = setInterval(() => void tick(), this.opts.healthCheckMs);
    // Don't keep the event loop alive solely for the health probe.
    const timerAny = s.healthTimer as unknown as { unref?: () => void };
    timerAny.unref?.();
  }

  private stopHealthLoop(): void {
    const s = this[_supervisorState];
    if (s.healthTimer) {
      clearInterval(s.healthTimer);
      s.healthTimer = null;
    }
  }

  /** Decide whether to restart, schedule it, and emit the right events. */
  private async scheduleRestart(err: Error): Promise<void> {
    const s = this[_supervisorState];
    if (s.stopRequested) return;

    this._lastError = err;

    if (this._restartCount >= this.opts.maxRestarts) {
      log.error(
        { restarts: this._restartCount, max: this.opts.maxRestarts, err },
        "max restarts exceeded; emitting fatal",
      );
      this.emit("fatal", {
        reason: `exceeded maxRestarts=${this.opts.maxRestarts}`,
        lastError: err,
        restarts: this._restartCount,
      });
      return;
    }

    const attempt = this._restartCount + 1;
    const delayMs = backoffDelay(this._restartCount);
    this.emit("restart", { attempt, delayMs, lastError: err });
    log.warn({ attempt, delayMs, err: err.message }, "scheduling restart");

    this._restartCount += 1;

    await new Promise<void>((r) => setTimeout(r, delayMs));

    if (s.stopRequested) return;
    try {
      await this._start();
    } catch (startErr) {
      // If the next start itself fails (e.g. spawn ENOENT), treat as a
      // "crash" and try the restart schedule again.
      log.error({ err: startErr }, "restart _start failed");
      if (!s.stopRequested && this.opts.restartOnCrash) {
        void this.scheduleRestart(
          startErr instanceof Error ? startErr : new Error(String(startErr)),
        );
      }
    }
  }
}

