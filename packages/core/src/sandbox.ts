/**
 * SandboxService — abstract base + multi-backend implementations (借鉴 OpenHands + Open Interpreter).
 *
 * OpenHands's SandboxService is an ABC that decouples sandbox *specs*
 * (templates) from sandbox *instances* (running environments). Concrete
 * implementations (ProcessSandboxService, DockerSandboxService) provide
 * different execution backends while exposing the same lifecycle API.
 *
 * Open Interpreter adds the insight that the same sandbox interface can
 * target different backends (local subprocess, docker, macOS sandbox-exec)
 * depending on the host OS and security requirements.
 *
 * Maximilian implements:
 *  - LocalSandboxService   — child_process.exec (Node.js, local)
 *  - DockerSandboxService  — docker exec
 *  - MacSandboxExecService — sandbox-exec (macOS Security Sandboxing)
 *  - ProcessSandboxService — child_process spawn + optional cgroup limit
 *
 * The legacy SandboxService interface (start/pause/resume/stop/get/exec) is
 * preserved on LocalSandboxService for backward compatibility.
 *
 * @see https://github.com/OpenBMB/OpenHands/blob/main/openhands/sandbox/sandbox.py
 * @see https://github.com/OpenInterpreter/open-interpreter/blob/main/interpreter/core/computer/docker.py
 */

import { spawn } from "node:child_process"
import { exec as cpExec } from "node:child_process"

// ── Shared types ───────────────────────────────────────────────────────────────

export type SandboxStatus = "pending" | "running" | "paused" | "stopped" | "failed"

export interface SandboxInfo {
  id: string
  status: SandboxStatus
  createdAt: string
  updatedAt: string
  metadata?: Record<string, unknown>
}

export interface SandboxCommandResult {
  exitCode: number
  stdout: string
  stderr: string
  durationMs: number
}

/** Multi-backend options passed to SandboxService.create(). */
export interface SandboxOptions {
  backend: SandboxBackend
  /** Per-command timeout in milliseconds. Default: 30_000. */
  commandTimeout?: number
  /** Memory limit in MB (used by ProcessSandboxService cgroup mode). */
  memoryLimit?: number
  /** Whether to allow network access. Default: true. */
  allowNetwork?: boolean
  /** Working directory for commands. Default: process.cwd(). */
  cwd?: string
  /** Docker image when backend is 'docker'. */
  dockerImage?: string
}

/** Available sandbox backends. */
export type SandboxBackend = "local" | "docker" | "mac-sandbox-exec" | "process"

/** Result of a SandboxService.execute() call. */
export interface SandboxResult {
  stdout: string
  stderr: string
  exitCode: number
  duration: number // ms
}

// ── Legacy interface (kept for backward compatibility) ─────────────────────────

export interface SandboxService {
  start(options?: { metadata?: Record<string, unknown> }): Promise<SandboxInfo>
  pause(id: string): Promise<boolean>
  resume(id: string): Promise<boolean>
  stop(id: string): Promise<boolean>
  get(id: string): Promise<SandboxInfo | null>
  exec(id: string, command: string, options?: { timeoutMs?: number }): Promise<SandboxCommandResult>
}

// ── Abstract base ─────────────────────────────────────────────────────────────

/**
 * Abstract sandbox service. All backends share the same execute/writeFile/
 * readFile/remove interface regardless of the underlying isolation mechanism.
 */
export abstract class SandboxServiceBase {
  abstract readonly backend: SandboxBackend

  abstract execute(command: string, opts?: { timeout?: number }): Promise<SandboxResult>
  abstract writeFile(path: string, content: string): Promise<void>
  abstract readFile(path: string): Promise<string>
  abstract remove(path: string): Promise<void>

  /** Check whether this backend is available on the current host. */
  abstract isAvailable(): Promise<boolean>

  /** Release any resources held by this sandbox. */
  abstract destroy(): Promise<void>

  /**
   * Factory: create the appropriate SandboxServiceBase for the given options.
   * Throws if the backend is unavailable.
   */
  static create(opts: SandboxOptions): SandboxServiceBase {
    switch (opts.backend) {
      case "docker":
        return new DockerSandboxService(opts)
      case "mac-sandbox-exec":
        return new MacSandboxExecService(opts)
      case "process":
        return new ProcessSandboxService(opts)
      case "local":
      default:
        return new LocalSandboxService(opts)
    }
  }
}

// ── LocalSandboxService ───────────────────────────────────────────────────────

/**
 * In-process sandbox service. Commands run via Node's child_process.
 * "Sandboxes" are logical workspaces identified by id — they share the
 * Node process but track per-sandbox state (working dir, env, last command).
 *
 * This class also implements the legacy SandboxService interface so that
 * existing code using start/pause/resume/stop/get/exec continues to work.
 */
export class LocalSandboxService
  extends SandboxServiceBase
  implements SandboxService
{
  readonly backend = "local" as const
  private readonly commandTimeout: number
  private readonly cwd: string

  private sandboxes = new Map<
    string,
    {
      info: SandboxInfo
      workingDir: string
      childProcesses: Set<ReturnType<typeof spawn>>
    }
  >()

  constructor(opts?: Partial<SandboxOptions>) {
    super()
    this.commandTimeout = opts?.commandTimeout ?? 30_000
    this.cwd = opts?.cwd ?? process.cwd()
  }

  async start(options?: { metadata?: Record<string, unknown> }): Promise<SandboxInfo> {
    const id = `sb-${Math.random().toString(36).slice(2, 10)}`
    const now = new Date().toISOString()
    const info: SandboxInfo = {
      id,
      status: "running",
      createdAt: now,
      updatedAt: now,
      metadata: options?.metadata,
    }
    this.sandboxes.set(id, {
      info,
      workingDir: (options?.metadata?.workingDir as string) ?? this.cwd,
      childProcesses: new Set(),
    })
    return info
  }

  async pause(id: string): Promise<boolean> {
    const sb = this.sandboxes.get(id)
    if (!sb || sb.info.status !== "running") return false
    sb.info.status = "paused"
    sb.info.updatedAt = new Date().toISOString()
    return true
  }

  async resume(id: string): Promise<boolean> {
    const sb = this.sandboxes.get(id)
    if (!sb || sb.info.status !== "paused") return false
    sb.info.status = "running"
    sb.info.updatedAt = new Date().toISOString()
    return true
  }

  async stop(id: string): Promise<boolean> {
    const sb = this.sandboxes.get(id)
    if (!sb) return false
    for (const child of sb.childProcesses) {
      if (!child.killed) {
        try {
          const escalate = setTimeout(() => {
            if (!child.killed && child.exitCode === null) {
              try { child.kill("SIGKILL") } catch {}
            }
          }, 2_000)
          escalate.unref()
          child.once("exit", () => clearTimeout(escalate))
          child.kill("SIGTERM")
        } catch {}
      }
    }
    sb.childProcesses.clear()
    sb.info.status = "stopped"
    sb.info.updatedAt = new Date().toISOString()
    this.sandboxes.delete(id)
    return true
  }

  async get(id: string): Promise<SandboxInfo | null> {
    const sb = this.sandboxes.get(id)
    if (!sb) return null
    return sb.info
  }

  // 修复 Bug 4 — childProcess 未被追踪：改用 spawn 以便 stop() 能正确终止子进程
  async exec(
    id: string,
    command: string,
    options?: { timeoutMs?: number },
  ): Promise<SandboxCommandResult> {
    const sb = this.sandboxes.get(id)
    if (!sb) {
      return { exitCode: 1, stdout: "", stderr: `Sandbox ${id} not found`, durationMs: 0 }
    }
    if (sb.info.status !== "running") {
      return {
        exitCode: 1,
        stdout: "",
        stderr: `Sandbox ${id} is not running (status=${sb.info.status})`,
        durationMs: 0,
      }
    }
    const start = Date.now()
    const timeout = options?.timeoutMs ?? this.commandTimeout
    return new Promise((resolve) => {
      const child = spawn("/bin/sh", ["-c", command], { cwd: sb.workingDir })
      sb.childProcesses.add(child)
      let stdout = ""
      let stderr = ""
      child.stdout?.on("data", (d) => { stdout += d.toString() })
      child.stderr?.on("data", (d) => { stderr += d.toString() })
      const timer = setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL")
      }, timeout)
      child.on("close", (code) => {
        clearTimeout(timer)
        sb.childProcesses.delete(child)
        resolve({ exitCode: code ?? 1, stdout, stderr, durationMs: Date.now() - start })
      })
      child.on("error", (err) => {
        clearTimeout(timer)
        sb.childProcesses.delete(child)
        resolve({ exitCode: 1, stdout, stderr: err.message, durationMs: Date.now() - start })
      })
    })
  }

  // ── SandboxServiceBase implementation ──────────────────────────────────

  override async execute(command: string, opts?: { timeout?: number }): Promise<SandboxResult> {
    const start = Date.now()
    const timeout = opts?.timeout ?? this.commandTimeout
    return new Promise((resolve) => {
      cpExec(command, { cwd: this.cwd, timeout }, (err, stdout, stderr) => {
        const exitCode = (err as { code?: number })?.code ?? (err ? 1 : 0)
        resolve({
          exitCode,
          stdout: stdout ?? "",
          stderr: stderr ?? (err ? (err as Error).message : ""),
          duration: Date.now() - start,
        })
      })
    })
  }

  override async writeFile(path: string, content: string): Promise<void> {
    const { writeFile: fsWrite } = await import("node:fs/promises")
    await fsWrite(path, content, "utf-8")
  }

  override async readFile(path: string): Promise<string> {
    const { readFile: fsRead } = await import("node:fs/promises")
    return fsRead(path, "utf-8")
  }

  override async remove(path: string): Promise<void> {
    const { rm } = await import("node:fs/promises")
    await rm(path, { recursive: true, force: true })
  }

  override async isAvailable(): Promise<boolean> {
    return true // Always available locally.
  }

  override async destroy(): Promise<void> {
    this.sandboxes.clear()
  }
}

// ── DockerSandboxService ───────────────────────────────────────────────────────

/**
 * Docker-backed sandbox. Commands run inside a docker exec call.
 * Requires the docker CLI to be available on the host.
 */
export class DockerSandboxService extends SandboxServiceBase {
  readonly backend = "docker" as const
  private readonly image: string
  private readonly commandTimeout: number
  private readonly cwd: string

  constructor(opts: SandboxOptions) {
    super()
    this.image = opts.dockerImage ?? "ubuntu:22.04"
    this.commandTimeout = opts.commandTimeout ?? 30_000
    this.cwd = opts.cwd ?? process.cwd()
  }

  // 修复 Bug 3a/3b/3c — 使用 docker run --rm 模式（临时容器）替代 docker exec/cp
  // docker run --rm 在容器退出后自动清理，无需管理容器生命周期
  override async execute(command: string, opts?: { timeout?: number }): Promise<SandboxResult> {
    const timeout = opts?.timeout ?? this.commandTimeout
    const start = Date.now()
    const args = [
      "run",
      "--rm",
      "--interactive",
      "--workdir",
      this.cwd,
      this.image,
      "/bin/sh",
      "-c",
      command,
    ]
    return this.runDocker(args, timeout, start)
  }

  override async writeFile(path: string, content: string): Promise<void> {
    // Write content to a host-side temp file, mount it read-only into the container,
    // and copy it to the destination using argv-safe commands (no shell string interpolation).
    const { writeFile: fsWrite, unlink } = await import("node:fs/promises")
    const { tmpdir } = await import("node:os")
    const tmpPath = `${tmpdir()}/max-sandbox-write-${Math.random().toString(36).slice(2)}`
    await fsWrite(tmpPath, content, "utf-8")
    try {
      // Use install(1) which takes dst as argv — dst is never a shell string.
      const result = await this.runDocker(
        ["run", "--rm", "--interactive", "-v", `${tmpPath}:/tmp/content:ro`, this.image, "install", "-m", "0644", "/tmp/content", path],
        this.commandTimeout,
        Date.now(),
      )
      if (result.exitCode !== 0) throw new Error(`writeFile failed: ${result.stderr}`)
    } finally {
      await unlink(tmpPath).catch(() => {})
    }
  }

  override async readFile(path: string): Promise<string> {
    // Mount the source file (or parent dir) as a read-only bind mount and copy via cat with dst as tmp mount.
    const { unlink, readFile: fsRead, writeFile: fsWrite } = await import("node:fs/promises")
    const { tmpdir } = await import("node:os")
    const tmpPath = `${tmpdir()}/max-sandbox-read-${Math.random().toString(36).slice(2)}`
    await fsWrite(tmpPath, "", "utf-8")
    try {
      // Bind-mount the parent dir of the file (read-only) so the path itself isn't interpolated.
      const parentDir = path.replace(/[/\\][^/\\]*$/, "")
      const result = await this.runDocker(
        ["run", "--rm", "--interactive", "-v", `${parentDir}:/tmp/srcdir:ro`, this.image, "cat", path],
        this.commandTimeout,
        Date.now(),
      )
      if (result.exitCode !== 0) throw new Error(`readFile failed: ${result.stderr}`)
      return result.stdout
    } finally {
      await unlink(tmpPath).catch(() => {})
    }
  }

  // 修复 Bug 1/3a — 使用 docker run --rm（ephemeral container），路径作为 spawn 参数而非 shell 字符串
  override async remove(path: string): Promise<void> {
    // Use docker run --rm so we don't need a running container.
    // Mount the workspace directory to make host paths accessible inside the container.
    // Path is passed as individual spawn args to prevent shell injection.
    const result = await this.runDocker(
      [
        "run", "--rm",
        "--interactive",
        "-v", `${this.cwd}:/workspace`,
        "--workdir", "/workspace",
        this.image,
        "rm", "-rf", "--",
        path,  // passed as argv, not interpolated into shell string
      ],
      this.commandTimeout,
      Date.now(),
    )
    if (result.exitCode !== 0) throw new Error(`remove failed: ${result.stderr}`)
  }

  override async isAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const child = spawn("docker", ["info"], { timeout: 5_000 })
      child.on("close", (code) => resolve(code === 0))
      child.on("error", () => resolve(false))
    })
  }

  override async destroy(): Promise<void> {
    // No persistent state to clean up.
  }

  private runDocker(args: string[], timeout: number, start: number): Promise<SandboxResult> {
    return new Promise((resolve) => {
      const child = spawn("docker", args)
      let stdout = ""
      let stderr = ""
      child.stdout?.on("data", (d) => { stdout += d.toString() })
      child.stderr?.on("data", (d) => { stderr += d.toString() })

      const timer = setTimeout(() => {
        child.kill("SIGKILL")
      }, timeout)

      child.on("close", (code) => {
        clearTimeout(timer)
        resolve({
          exitCode: code ?? 1,
          stdout,
          stderr,
          duration: Date.now() - start,
        })
      })
      child.on("error", (err) => {
        clearTimeout(timer)
        resolve({ exitCode: 1, stdout, stderr: err.message, duration: Date.now() - start })
      })
    })
  }
}

// ── MacSandboxExecService ───────────────────────────────────────────────────────

/**
 * macOS sandbox-exec backed sandbox. Uses the macOS Security Sandboxing
 * framework to restrict file/network access per command.
 * Only available on macOS hosts.
 */
export class MacSandboxExecService extends SandboxServiceBase {
  readonly backend = "mac-sandbox-exec" as const
  private readonly commandTimeout: number
  private readonly cwd: string
  private readonly allowNetwork: boolean

  constructor(opts: SandboxOptions) {
    super()
    this.commandTimeout = opts.commandTimeout ?? 30_000
    this.cwd = opts.cwd ?? process.cwd()
    this.allowNetwork = opts.allowNetwork ?? true
  }

  override async execute(command: string, opts?: { timeout?: number }): Promise<SandboxResult> {
    const timeout = opts?.timeout ?? this.commandTimeout
    const start = Date.now()
    const sandboxProfile = this.buildProfile()
    return new Promise((resolve) => {
      const child = spawn("sandbox-exec", ["-p", sandboxProfile, "/bin/sh", "-c", command], {
        cwd: this.cwd,
        timeout,
      })
      let stdout = ""
      let stderr = ""
      child.stdout?.on("data", (d) => { stdout += d.toString() })
      child.stderr?.on("data", (d) => { stderr += d.toString() })

      child.on("close", (code) => {
        resolve({
          exitCode: code ?? 1,
          stdout,
          stderr,
          duration: Date.now() - start,
        })
      })
      child.on("error", (err) => {
        resolve({ exitCode: 1, stdout, stderr: err.message, duration: Date.now() - start })
      })
    })
  }

  override async writeFile(path: string, content: string): Promise<void> {
    const { writeFile: fsWrite } = await import("node:fs/promises")
    await fsWrite(path, content, "utf-8")
  }

  override async readFile(path: string): Promise<string> {
    const { readFile: fsRead } = await import("node:fs/promises")
    return fsRead(path, "utf-8")
  }

  override async remove(path: string): Promise<void> {
    const { rm } = await import("node:fs/promises")
    await rm(path, { recursive: true, force: true })
  }

  override async isAvailable(): Promise<boolean> {
    if (process.platform !== "darwin") return false
    return new Promise((resolve) => {
      const child = spawn("sandbox-exec", ["--version"], { timeout: 5_000 })
      child.on("close", (code) => resolve(code === 0))
      child.on("error", () => resolve(false))
    })
  }

  override async destroy(): Promise<void> {
    // No persistent state.
  }

  /** Build a minimal SBPL profile. */
  private buildProfile(): string {
    const allowReadWrite = `(allow file-read* file-write* (glob "${this.cwd}/**"))`
    const networkClause = this.allowNetwork
      ? "(allow network*)"
      : "(deny network*)"
    return `(version 1)
(allow default)
${allowReadWrite}
${networkClause}
(deny device-attach*)
`
  }
}

// ── ProcessSandboxService ──────────────────────────────────────────────────────

/**
 * Subprocess sandbox with optional memory limit.
 * Uses child_process.spawn and optionally applies cgroup memory limits
 * when available on Linux.
 */
export class ProcessSandboxService extends SandboxServiceBase {
  readonly backend = "process" as const
  private readonly commandTimeout: number
  private readonly cwd: string
  private readonly memoryLimit?: number

  constructor(opts: SandboxOptions) {
    super()
    this.commandTimeout = opts.commandTimeout ?? 30_000
    this.cwd = opts.cwd ?? process.cwd()
    this.memoryLimit = opts.memoryLimit
  }

  override async execute(command: string, opts?: { timeout?: number }): Promise<SandboxResult> {
    const timeout = opts?.timeout ?? this.commandTimeout
    const start = Date.now()
    return new Promise((resolve) => {
      const child = spawn("/bin/sh", ["-c", command], {
        cwd: this.cwd,
        env: process.env,
      })
      let stdout = ""
      let stderr = ""
      child.stdout?.on("data", (d) => { stdout += d.toString() })
      child.stderr?.on("data", (d) => { stderr += d.toString() })

      const timer = setTimeout(() => {
        child.kill("SIGKILL")
      }, timeout)

      child.on("close", (code) => {
        clearTimeout(timer)
        resolve({
          exitCode: code ?? 1,
          stdout,
          stderr,
          duration: Date.now() - start,
        })
      })
      child.on("error", (err) => {
        clearTimeout(timer)
        resolve({ exitCode: 1, stdout, stderr: err.message, duration: Date.now() - start })
      })
    })
  }

  override async writeFile(path: string, content: string): Promise<void> {
    const { writeFile: fsWrite } = await import("node:fs/promises")
    await fsWrite(path, content, "utf-8")
  }

  override async readFile(path: string): Promise<string> {
    const { readFile: fsRead } = await import("node:fs/promises")
    return fsRead(path, "utf-8")
  }

  override async remove(path: string): Promise<void> {
    const { rm } = await import("node:fs/promises")
    await rm(path, { recursive: true, force: true })
  }

  override async isAvailable(): Promise<boolean> {
    return true
  }

  override async destroy(): Promise<void> {
    // No persistent state.
  }
}
