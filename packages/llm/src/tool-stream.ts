// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Streaming Tool Protocol — 借鉴 grok-build tool.rs ToolStream
 *
 * grok-build 定义:
 *   ToolStream<T> = Pin<Box<dyn Stream<Item = ToolStreamItem<T>> + Send>>
 *   ToolStreamItem::{Progress, Terminal}
 *   固定结构: [Progress*; Terminal]
 *
 * Maximilian 的 TypeScript 实现:
 *   - ToolStreamItem 是 Progress | Terminal 的区分联合
 *   - AsyncIterable<ToolStreamItem> 是流式输出的基础
 *   - Progress 表示中间输出（实时日志、进度等）
 *   - Terminal 表示最终结果
 *
 * @see crates/common/xai-tool-runtime/src/tool.rs ToolStream
 */

import type { ToolContent } from "./messages.js"
import type { ToolExecuteContext } from "./tool-context.js"

// ── ToolStreamItem 联合类型 ─────────────────────────────────────────────────

/**
 * 工具执行过程中的进度/中间输出项。
 */
export interface ToolProgress<Item = unknown> {
  readonly type: "progress"
  /** 进度消息或数据 */
  readonly content: ToolProgressContent<Item>
  /** 时间戳 */
  readonly timestamp: number
}

/**
 * 进度内容类型
 */
export type ToolProgressContent<Item = unknown> =
  | { kind: "text"; text: string }
  | { kind: "stdout"; data: string }
  | { kind: "stderr"; data: string }
  | { kind: "json"; data: Item }
  | { kind: "resource"; uri: string; description?: string }
  | { kind: "notification"; message: string; level?: "info" | "warn" | "error" }

/**
 * 工具执行终止项，表示最终结果或错误。
 */
export interface ToolTerminal<Success = unknown, Error = string> {
  readonly type: "terminal"
  /** 是否成功 */
  readonly ok: boolean
  /** 成功时的结果 */
  readonly result?: Success
  /** 失败时的错误信息 */
  readonly error?: Error
  /** 总耗时（毫秒） */
  readonly durationMs: number
}

/**
 * 工具流中的单个项。
 * 必须是 Progress（0个或多个）后跟 1 个 Terminal。
 */
export type ToolStreamItem<Success = unknown, Error = string> =
  | ToolProgress<Success>
  | ToolTerminal<Success, Error>

// ── Type Guards ───────────────────────────────────────────────────────────────

/**
 * 判断是否为 Progress 项
 */
export function isProgress<Item>(
  item: ToolStreamItem<Item>,
): item is ToolProgress<Item> {
  return item.type === "progress"
}

/**
 * 判断是否为 Terminal 项
 */
export function isTerminal<Success, Error>(
  item: ToolStreamItem<Success, Error>,
): item is ToolTerminal<Success, Error> {
  return item.type === "terminal"
}

// ── Stream Builder Helpers ─────────────────────────────────────────────────────

/**
 * 创建进度项
 */
export function progress<Item>(
  content: ToolProgressContent<Item>,
  timestamp = Date.now(),
): ToolProgress<Item> {
  return Object.freeze({ type: "progress", content, timestamp })
}

/**
 * 创建文本进度项
 */
export function progressText(text: string): ToolProgress {
  return progress({ kind: "text", text })
}

/**
 * 创建 stdout 进度项
 */
export function progressStdout(data: string): ToolProgress {
  return progress({ kind: "stdout", data })
}

/**
 * 创建 stderr 进度项
 */
export function progressStderr(data: string): ToolProgress {
  return progress({ kind: "stderr", data })
}

/**
 * 创建 JSON 进度项
 */
export function progressJson<Item>(data: Item): ToolProgress<Item> {
  return progress({ kind: "json", data })
}

/**
 * 创建通知进度项
 */
export function progressNotification(
  message: string,
  level: "info" | "warn" | "error" = "info",
): ToolProgress {
  return progress({ kind: "notification", message, level })
}

/**
 * 创建成功终止项
 */
export function terminalSuccess<Success>(
  result: Success,
  durationMs: number,
): ToolTerminal<Success> {
  return Object.freeze({ type: "terminal", ok: true, result, durationMs })
}

/**
 * 创建失败终止项
 */
export function terminalError<Error = string>(
  error: Error,
  durationMs: number,
): ToolTerminal<unknown, Error> {
  return Object.freeze({ type: "terminal", ok: false, error, durationMs })
}

// ── AsyncIterable Stream Factories ──────────────────────────────────────────────

/**
 * 将 Promise<Success> 包装为单终止项的 AsyncIterable。
 *
 * @example
 * const stream = fromPromise(myToolExecute(input))
 * for await (const item of stream) {
 *   if (isTerminal(item)) console.log("Done:", item.result)
 * }
 */
export async function* fromPromise<Success>(
  promise: Promise<Success>,
): AsyncIterable<ToolStreamItem<Success>> {
  const start = Date.now()
  try {
    const result = await promise
    yield terminalSuccess(result, Date.now() - start)
  } catch (error) {
    // Cast needed because terminalError returns ToolTerminal<unknown, Error>
    // which isn't directly assignable to ToolTerminal<Success, Error> due to invariance
    ;(yield terminalError(
      error instanceof Error ? error.message : String(error),
      Date.now() - start,
    ) as ToolStreamItem<Success>)
  }
}

/**
 * 将 Progress 内容转换为 LLM 可见的 ToolContent。
 */
export function progressToContent(item: ToolProgress): ToolContent[] {
  const { content } = item
  switch (content.kind) {
    case "text":
      return [{ type: "text", text: content.text }]
    case "stdout":
      return [{ type: "text", text: content.data }]
    case "stderr":
      return [{ type: "text", text: `[stderr] ${content.data}` }]
    case "json":
      return [{ type: "text", text: JSON.stringify(content.data) }]
    case "resource":
      return [
        {
          type: "text",
          text: content.description
            ? `[Resource] ${content.uri}: ${content.description}`
            : `[Resource] ${content.uri}`,
        },
      ]
    case "notification":
      return [
        {
          type: "text",
          text:
            content.level === "error"
              ? `[Error] ${content.message}`
              : content.level === "warn"
                ? `[Warning] ${content.message}`
                : `[Info] ${content.message}`,
        },
      ]
  }
}

/**
 * 将 ToolTerminal 转换为 ToolContent 数组。
 */
export function terminalToContent<Success>(
  item: ToolTerminal<Success>,
): ToolContent[] {
  if (item.ok) {
    if (item.result === undefined) return []
    if (typeof item.result === "string") return [{ type: "text", text: item.result }]
    return [{ type: "text", text: JSON.stringify(item.result) }]
  }
  return [{ type: "text", text: `Error: ${item.error ?? "unknown"}` }]
}

// ── Streaming Tool Interface ────────────────────────────────────────────────────

/**
 * 支持流式执行的工具接口。
 *
 * 与普通 Tool 的区别：
 * - execute 返回 AsyncIterable<ToolStreamItem> 而非 Promise<Success>
 * - 可以实时产出中间进度
 * - 最终必须产出 Terminal 项
 */
export interface StreamingTool<Params = unknown, Success = unknown> {
  readonly name: string
  readonly description: string
  readonly kind?: import("./tool-kind.js").ToolKind
  readonly inputSchema: Record<string, unknown>
  readonly outputSchema?: Record<string, unknown>
  /**
   * 执行工具并返回流式输出。
   * 必须产出 [Progress*; Terminal] 结构。
   */
  execute(
    input: Params,
    context: ToolExecuteContext,
  ): AsyncIterable<ToolStreamItem<Success>>
}

// ── Tool Output 转换 ────────────────────────────────────────────────────────────

import type { ToolOutput } from "./messages.js"

/**
 * 将完整的流式输出转换为 ToolOutput。
 *
 * 用于流式执行完成后，将所有项汇总为单一的 ToolOutput。
 */
export function streamToToolOutput<Success>(
  items: ToolStreamItem<Success>[],
): ToolOutput {
  let finalResult: Success | undefined
  let finalError: string | undefined
  const content: ToolContent[] = []

  for (const item of items) {
    if (isProgress(item)) {
      content.push(...progressToContent(item))
    } else if (item.type === "terminal") {
      finalResult = item.result
      finalError = item.error as string | undefined
      content.push(...terminalToContent(item))
    }
  }

  return {
    structured: finalError !== undefined
      ? { error: finalError }
      : (finalResult ?? { error: "unknown" }),
    content,
  }
}

// ── Stream Transformer ──────────────────────────────────────────────────────────

/**
 * 将普通 Promise 工具适配为流式工具。
 *
 * @param tool 普通工具（execute 返回 Promise）
 * @returns 包装后的流式工具
 */
export function toStreamingTool<Params, Success>(
  tool: {
    name: string
    description: string
    kind?: import("./tool-kind.js").ToolKind
    inputSchema: Record<string, unknown>
    outputSchema?: Record<string, unknown>
    execute: (input: Params, context: ToolExecuteContext) => Promise<Success>
  },
): StreamingTool<Params, Success> {
  return {
    name: tool.name,
    description: tool.description,
    kind: tool.kind,
    inputSchema: tool.inputSchema,
    outputSchema: tool.outputSchema,
    async *execute(input: Params, context: ToolExecuteContext) {
      const start = Date.now()
      try {
        const result = await tool.execute(input, context)
        yield terminalSuccess(result, Date.now() - start)
      } catch (error) {
        // Cast needed because terminalError returns ToolTerminal<unknown, Error>
        ;(yield terminalError(
          error instanceof Error ? error.message : String(error),
          Date.now() - start,
        ) as ToolStreamItem<Success>)
      }
    },
  }
}
