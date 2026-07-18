// Bash tool — execute shell commands
// Derived from OpenCode packages/core/src/tool/bash.ts
// Plain TypeScript, no Effect-TS

import { makeTool, type ToolContent, ToolKind } from "@max/llm"
import { spawn } from "node:child_process"

const DEFAULT_TIMEOUT_MS = 120_000
const MAX_TIMEOUT_MS = 600_000
const MAX_CAPTURE_BYTES = 1024 * 1024 // 1MB

export interface BashInput {
  command: string
  workdir?: string
  timeout?: number
  description?: string
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
  description: "Execute a shell command and return its output.",
  kind: ToolKind.Execute,
  inputSchema: {
    type: "object",
    properties: {
      command: { type: "string", description: "The command to execute" },
      workdir: { type: "string", description: "Working directory (optional)" },
      timeout: { type: "number", description: "Timeout in milliseconds (default: 120000)" },
      description: { type: "string", description: "Description of what the command does" },
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
    },
  },
  async execute(input) {
    const cwd = input.workdir ?? process.cwd()
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
    if (output.exitCode !== 0) lines.push(`Exit code: ${output.exitCode}`)
    if (output.timedOut) lines.push("Command timed out")
    lines.push(output.output)
    return [{ type: "text", text: lines.join("\n") }]
  },
})
