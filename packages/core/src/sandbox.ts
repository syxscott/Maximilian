/**
 * SandboxService — abstract base + local implementation (借鉴 OpenHands).
 *
 * OpenHands's SandboxService is an ABC that decouples sandbox *specs*
 * (templates) from sandbox *instances* (running environments). Concrete
 * implementations (ProcessSandboxService, DockerSandboxService) provide
 * different execution backends while exposing the same lifecycle API.
 *
 * Maximilian adapts this with a tiny standalone SandboxService interface
 * plus a default LocalSandboxService that runs commands in-process. Apps
 * that need isolation (Docker, remote) can swap in their own
 * implementation behind the same interface.
 */

export type SandboxStatus = "pending" | "running" | "paused" | "stopped" | "failed"

export interface SandboxInfo {
  id: string
  status: SandboxStatus
  createdAt: string
  /** Last status update. */
  updatedAt: string
  /** Free-form metadata (working dir, env, etc.). */
  metadata?: Record<string, unknown>
}

export interface SandboxCommandResult {
  exitCode: number
  stdout: string
  stderr: string
  durationMs: number
}

export interface SandboxService {
  /** Start a new sandbox. Returns the new sandbox's info. */
  start(options?: { metadata?: Record<string, unknown> }): Promise<SandboxInfo>
  /** Pause a running sandbox. Returns true on success. */
  pause(id: string): Promise<boolean>
  /** Resume a paused sandbox. Returns true on success. */
  resume(id: string): Promise<boolean>
  /** Stop and remove a sandbox. Returns true on success. */
  stop(id: string): Promise<boolean>
  /** Look up a sandbox by id. Returns null if not found. */
  get(id: string): Promise<SandboxInfo | null>
  /** Execute `command` in `id` with a timeout (ms). */
  exec(id: string, command: string, options?: { timeoutMs?: number }): Promise<SandboxCommandResult>
}

/**
 * In-process sandbox service. Commands run via Node's child_process.
 * "Sandboxes" are logical workspaces identified by id — they share the
 * Node process but track per-sandbox state (working dir, env, last command).
 *
 * For real isolation, callers should swap in a Docker-backed or remote
 * implementation; this one is for tests + local dev.
 */
export class LocalSandboxService implements SandboxService {
  private sandboxes = new Map<
    string,
    SandboxInfo & {
      workingDir?: string
      childProcesses: Set<import("node:child_process").ChildProcess>
    }
  >()

  async start(options?: { metadata?: Record<string, unknown> }): Promise<SandboxInfo> {
    const id = `sb-${Math.random().toString(36).slice(2, 10)}`
    const now = new Date().toISOString()
    const info: SandboxInfo & {
      workingDir?: string
      childProcesses: Set<import("node:child_process").ChildProcess>
    } = {
      id,
      status: "running",
      createdAt: now,
      updatedAt: now,
      metadata: options?.metadata,
      workingDir: (options?.metadata?.workingDir as string) ?? process.cwd(),
      childProcesses: new Set(),
    }
    this.sandboxes.set(id, info)
    return info
  }

  async pause(id: string): Promise<boolean> {
    const sb = this.sandboxes.get(id)
    if (!sb || sb.status !== "running") return false
    sb.status = "paused"
    sb.updatedAt = new Date().toISOString()
    return true
  }

  async resume(id: string): Promise<boolean> {
    const sb = this.sandboxes.get(id)
    if (!sb || sb.status !== "paused") return false
    sb.status = "running"
    sb.updatedAt = new Date().toISOString()
    return true
  }

  async stop(id: string): Promise<boolean> {
    const sb = this.sandboxes.get(id)
    if (!sb) return false
    // Kill any spawned child processes that are still running. Without
    // this, `stop()` would leave orphaned processes running in the
    // background - e.g. a long-running `npm test` or a detached server
    // would keep consuming resources after the sandbox is "stopped".
    // SIGTERM first (graceful), then escalate to SIGKILL after 2s if
    // the process hasn't exited.
    for (const child of sb.childProcesses) {
      if (!child.killed) {
        try {
          child.kill("SIGTERM")
          const escalate = setTimeout(() => {
            if (!child.killed && child.exitCode === null) {
              try {
                child.kill("SIGKILL")
              } catch {}
            }
          }, 2_000)
          child.once("exit", () => clearTimeout(escalate))
        } catch {}
      }
    }
    sb.childProcesses.clear()
    sb.status = "stopped"
    sb.updatedAt = new Date().toISOString()
    this.sandboxes.delete(id)
    return true
  }

  async get(id: string): Promise<SandboxInfo | null> {
    const sb = this.sandboxes.get(id)
    if (!sb) return null
    const { workingDir: _, childProcesses: __, ...info } = sb
    return info
  }

  async exec(
    id: string,
    command: string,
    options?: { timeoutMs?: number },
  ): Promise<SandboxCommandResult> {
    const sb = this.sandboxes.get(id)
    if (!sb) {
      return { exitCode: 1, stdout: "", stderr: `Sandbox ${id} not found`, durationMs: 0 }
    }
    if (sb.status !== "running") {
      return {
        exitCode: 1,
        stdout: "",
        stderr: `Sandbox ${id} is not running (status=${sb.status})`,
        durationMs: 0,
      }
    }
    // Use Node's exec via dynamic import — keeps the module small.
    const { exec: cpExec } = await import("node:child_process")
    const start = Date.now()
    const timeout = options?.timeoutMs ?? 30_000
    return new Promise((resolve) => {
      const child = cpExec(command, { cwd: sb.workingDir, timeout }, (err, stdout, stderr) => {
        sb.childProcesses.delete(child)
        if (err) {
          const e = err as { code?: number }
          resolve({
            exitCode: e.code ?? 1,
            stdout: stdout ?? "",
            stderr: stderr ?? err.message,
            durationMs: Date.now() - start,
          })
        } else {
          resolve({ exitCode: 0, stdout, stderr, durationMs: Date.now() - start })
        }
      })
      sb.childProcesses.add(child)
    })
  }
}
