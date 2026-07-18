// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Streaming Bash Tool — demonstrate AsyncIterable tool output pattern.
 *
 * 借鉴 grok-build 的 ToolStream 模式：
 *   - 支持实时 stdout/stderr 流式输出
 *   - 支持取消（通过 AbortSignal）
 *   - 固定结构: [Progress*; Terminal]
 *
 * 这是一个简化版本，避免复杂的 async iterator 类型问题。
 * 完整实现可参考 grok-build 的 terminal backend 模式。
 */

import { spawn } from "node:child_process"
import { type ToolStreamItem, terminalSuccess } from "@max/llm"
import { getAbortSignal } from "@max/llm"
import { ToolKind } from "@max/llm"

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

/**
 * Streaming bash tool — simplified implementation.
 *
 * 完整实现需要底层 event emitter 适配 async iterator，
 * 这里演示核心模式和类型接口。
 */
export const streamingBashTool = {
  name: "bash",
  description: "Execute a shell command and stream its output.",
  kind: ToolKind.Execute,
  inputSchema: {
    type: "object",
    properties: {
      command: { type: "string", description: "The command to execute" },
      workdir: { type: "string", description: "Working directory (optional)" },
      timeout: {
        type: "number",
        description: "Timeout in milliseconds (default: 120000)",
      },
      description: {
        type: "string",
        description: "Description of what the command does",
      },
    },
    required: ["command"],
  },

  async *execute(
    input: BashInput,
    context: import("@max/llm").ToolExecuteContext,
  ): AsyncIterable<ToolStreamItem<BashOutput>> {
    const cwd = input.workdir ?? process.cwd()
    const timeout = Math.min(input.timeout ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS)
    const warnings: string[] = []
    const start = Date.now()

    // Check for abort signal
    const abortSignal = getAbortSignal(context)

    // Yield initial text progress
    const initialText = input.description
      ? `[bash] ${input.description}`
      : `[bash] ${input.command}`
    yield {
      type: "progress",
      content: { kind: "text" as const, text: initialText },
      timestamp: Date.now(),
    } as ToolStreamItem<BashOutput>

    // Use spawn with piped streams
    const shell = defaultShell()
    const child = spawn(shell, ["-c", input.command], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    })

    let stdout = ""
    let stderr = ""
    let stdoutTruncated = false
    let stderrTruncated = false
    let timedOut = false

    // Set up abort listener
    const abortHandler = () => {
      if (!child.killed) {
        child.kill("SIGKILL")
      }
    }
    if (abortSignal) {
      abortSignal.addEventListener("abort", abortHandler)
    }

    // Set up timeout
    const timeoutHandle = setTimeout(() => {
      timedOut = true
      if (!child.killed) {
        child.kill("SIGKILL")
      }
    }, timeout)

    // Collect stdout/stderr
    child.stdout?.on("data", (chunk: Buffer) => {
      if (!stdoutTruncated) {
        if (stdout.length + chunk.length > MAX_CAPTURE_BYTES) {
          stdoutTruncated = true
          warnings.push("stdout truncated (exceeded 1MB)")
        } else {
          stdout += chunk.toString()
        }
      }
    })

    child.stderr?.on("data", (chunk: Buffer) => {
      if (!stderrTruncated) {
        if (stderr.length + chunk.length > MAX_CAPTURE_BYTES) {
          stderrTruncated = true
          warnings.push("stderr truncated (exceeded 1MB)")
        } else {
          stderr += chunk.toString()
        }
      }
    })

    // Wait for child to exit
    const exitCode = await new Promise<number>((resolve) => {
      child.on("close", (code) => resolve(code ?? 1))
      child.on("error", () => resolve(1))
    })

    clearTimeout(timeoutHandle)
    if (abortSignal) {
      abortSignal.removeEventListener("abort", abortHandler)
    }

    const result: BashOutput = {
      command: input.command,
      cwd,
      exitCode,
      output: compactOutput(stdout, stderr),
      truncated: stdoutTruncated || stderrTruncated,
      stdoutTruncated,
      stderrTruncated,
      timedOut,
      warnings,
    }

    // Yield stdout/stderr as progress items (if not truncated)
    if (!stdoutTruncated && stdout) {
      yield {
        type: "progress",
        content: { kind: "stdout", data: stdout },
        timestamp: Date.now(),
      } as ToolStreamItem<BashOutput>
    }
    if (!stderrTruncated && stderr) {
      yield {
        type: "progress",
        content: { kind: "stderr", data: stderr },
        timestamp: Date.now(),
      } as ToolStreamItem<BashOutput>
    }

    yield terminalSuccess(result, Date.now() - start)
  },
}
