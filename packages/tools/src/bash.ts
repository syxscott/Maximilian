// Bash tool — execute shell commands
// Derived from OpenCode packages/core/src/tool/bash.ts
// Plain TypeScript, no Effect-TS
//
// (borrowing) Mini-Agent mini_agent/tools/bash_tool.py — run_in_background
// hands the process to the BackgroundShellRegistry and returns its
// bash_id immediately; output and termination go through the
// `bash_output` / `bash_kill` tools.

import { makeTool, type ToolContent, ToolKind } from "@max/llm"
import { spawn } from "node:child_process"
import { getBackgroundShellRegistry } from "./bash-background.js"

const DEFAULT_TIMEOUT_MS = 120_000
const MAX_TIMEOUT_MS = 600_000
const MAX_CAPTURE_BYTES = 1024 * 1024 // 1MB

export interface BashInput {
  command: string
  workdir?: string
  timeout?: number
  description?: string
  /**
   * Set true for long-running commands (dev servers, watchers, long
   * tests). Returns immediately with a bashId; monitor progress with
   * `bash_output` and terminate with `bash_kill`.
   */
  run_in_background?: boolean
}

export interface BashOutput {
  command: string
  cwd: string
  exitCode: number
  output: string
  truncated: boolean
  stdoutTruncated: boolean
  stderrTruncated: boolean
  timedOut: boolean
  warnings: string[]
  /** Set on background starts: the registry handle for bash_output/bash_kill. */
  bashId?: string
  /** True when the command was handed to the background registry. */
  background?: boolean
  /** Current registry status of a background shell. */
  status?: string
}

function defaultShell(): string {
  return process.env.SHELL ?? "/bin/bash"
}

function compactOutput(stdout: string, stderr: string): string {
  const parts: string[] = []
  if (stdout.trim()) parts.push(stdout.trim())
  if (stderr.trim()) parts.push(`[stderr]\n${stderr.trim()}`)
  return parts.join("\n")
}

export const bashTool = makeTool<BashInput, BashOutput>({
  name: "bash",
  description:
    "Execute a shell command and return its output. " +
    "For long-running commands (servers, watchers, long tests) set run_in_background=true " +
    "to get a bashId immediately, then poll with bash_output and stop with bash_kill.",
  kind: ToolKind.Execute,
  inputSchema: {
    type: "object",
    properties: {
      command: { type: "string", description: "The command to execute" },
      workdir: { type: "string", description: "Working directory (optional)" },
      timeout: {
        type: "number",
        description: "Timeout in milliseconds (default: 120000). Foreground commands only.",
      },
      description: { type: "string", description: "Description of what the command does" },
      run_in_background: {
        type: "boolean",
        description:
          "Set true to run the command in the background (dev servers, watchers, long tests). " +
          "Returns a bashId immediately; monitor with bash_output, terminate with bash_kill.",
      },
    },
    required: ["command"],
  },
  outputSchema: {
    type: "object",
    properties: {
      command: { type: "string" },
      cwd: { type: "string" },
      exitCode: { type: "number" },
      output: { type: "string" },
      truncated: { type: "boolean" },
      stdoutTruncated: { type: "boolean" },
      stderrTruncated: { type: "boolean" },
      timedOut: { type: "boolean" },
      warnings: { type: "array", items: { type: "string" } },
      bashId: { type: "string" },
      background: { type: "boolean" },
      status: { type: "string" },
    },
  },
  async execute(input) {
    const cwd = input.workdir ?? process.cwd()

    // (borrowing) Mini-Agent background branch: spawn through the
    // registry and return the bash_id immediately — the process keeps
    // running and its output is collected by the registry.
    if (input.run_in_background === true) {
      const started = getBackgroundShellRegistry().start(input.command, cwd)
      if (!started.ok) {
        // Registry rejection (cap reached) is a normal, model-visible
        // condition — surface it in output/warnings, not as a throw.
        return {
          command: input.command,
          cwd,
          exitCode: 1,
          output: started.error,
          truncated: false,
          stdoutTruncated: false,
          stderrTruncated: false,
          timedOut: false,
          warnings: [started.error],
          background: true,
          status: "error" as const,
        }
      }
      return {
        command: input.command,
        cwd,
        exitCode: 0,
        output: `Command started in background. Use bash_output to monitor (bash_id='${started.bashId}').`,
        truncated: false,
        stdoutTruncated: false,
        stderrTruncated: false,
        timedOut: false,
        warnings: [],
        bashId: started.bashId,
        background: true,
        status: started.status,
      }
    }

    const timeout = Math.min(input.timeout ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS)
    const warnings: string[] = []

    return new Promise<BashOutput>((resolve, reject) => {
      const shell = defaultShell()
      const proc = spawn(shell, ["-c", input.command], {
        cwd,
        stdio: ["pipe", "pipe", "pipe" as const],
      })

      let stdout = ""
      let stderr = ""
      let stdoutTruncated = false
      let stderrTruncated = false
      let timedOut = false

      // Use setTimeout for timeout tracking since spawn's timeout option doesn't emit "timeout" event
      const timer = setTimeout(() => {
        timedOut = true
        proc.kill("SIGKILL")
      }, timeout)

      proc.stdout?.on("data", (chunk: Buffer) => {
        if (stdout.length + chunk.length > MAX_CAPTURE_BYTES) {
          stdoutTruncated = true
          warnings.push("stdout truncated (exceeded 1MB)")
          return
        }
        stdout += chunk.toString()
      })

      proc.stderr?.on("data", (chunk: Buffer) => {
        if (stderr.length + chunk.length > MAX_CAPTURE_BYTES) {
          stderrTruncated = true
          warnings.push("stderr truncated (exceeded 1MB)")
          return
        }
        stderr += chunk.toString()
      })

      proc.on("error", (err) => {
        clearTimeout(timer)
        if ((err as NodeJS.ErrnoException).code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
          warnings.push("output buffer exceeded")
        }
        reject(err)
      })

      proc.on("close", (code) => {
        clearTimeout(timer)
        resolve({
          command: input.command,
          cwd,
          exitCode: timedOut ? 124 : (code ?? 1), // 124 is standard timeout exit code
          output: compactOutput(stdout, stderr),
          truncated: stdoutTruncated || stderrTruncated,
          stdoutTruncated,
          stderrTruncated,
          timedOut,
          warnings,
        })
      })
    })
  },
  toModelOutput(output): ToolContent[] {
    const lines: string[] = []
    if (output.background) {
      if (output.bashId) lines.push(`Bash ID: ${output.bashId}`)
      if (output.status && output.status !== "running") lines.push(`Status: ${output.status}`)
    }
    if (output.exitCode !== 0) lines.push(`Exit code: ${output.exitCode}`)
    if (output.timedOut) lines.push("Command timed out")
    lines.push(output.output)
    return [{ type: "text", text: lines.join("\n") }]
  },
})
