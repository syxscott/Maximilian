// Tool interface — plain TypeScript, no Effect-TS
// Derived from OpenCode packages/llm/src/tool.ts and packages/core/src/tool/tool.ts

import type { JsonSchema } from "./types.js"
import type { ToolContent, ToolDefinition, ToolOutput } from "./messages.js"
import type { ToolExecuteContext } from "./tool-context.js"

// Re-export ToolExecuteContext from tool-context for backward compatibility
export type { ToolExecuteContext } from "./tool-context.js"

// ── Tool Definition ──

export interface Tool<Params = unknown, Success = unknown> {
  readonly name: string
  readonly description: string
  /** 工具能力分类，用于 capability gating 和穷举检查 */
  readonly kind?: import("./tool-kind.js").ToolKind
  readonly inputSchema: JsonSchema
  readonly outputSchema?: JsonSchema
  readonly execute?: (input: Params, context: ToolExecuteContext) => Promise<Success>
  readonly toModelOutput?: (input: Success) => ToolContent[]
}

export type AnyTool = Tool<any, any>

// ── Tool Factory ──

export function makeTool<Params, Success>(config: {
  name: string
  description: string
  /** 工具能力分类，用于 capability gating 和穷举检查 */
  kind?: import("./tool-kind.js").ToolKind
  inputSchema: JsonSchema
  outputSchema?: JsonSchema
  execute?: (input: Params, context: ToolExecuteContext) => Promise<Success>
  toModelOutput?: (input: Success) => ToolContent[]
}): Tool<Params, Success> {
  return Object.freeze({
    name: config.name,
    description: config.description,
    kind: config.kind,
    inputSchema: config.inputSchema,
    outputSchema: config.outputSchema,
    execute: config.execute,
    toModelOutput: config.toModelOutput,
  })
}

// ── Tool to LLM Definition ──

export function toToolDefinition(tool: AnyTool): ToolDefinition {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    outputSchema: tool.outputSchema,
  }
}

export function toDefinitions(tools: AnyTool[]): ToolDefinition[] {
  return tools.map(toToolDefinition)
}

// ── Permission Decorator ──

export interface ToolPermission {
  readonly permission: string
}

export function withPermission<Params, Success>(
  tool: Tool<Params, Success>,
  permission: string,
): Tool<Params, Success> & ToolPermission {
  return Object.freeze({ ...tool, permission })
}

export function hasPermission(tool: AnyTool): tool is AnyTool & ToolPermission {
  return "permission" in tool && typeof (tool as Record<string, unknown>).permission === "string"
}

// ── Tool Settlement (result of executing a tool) ──

export interface ToolSettlement {
  readonly result: unknown
  readonly output?: ToolOutput
  readonly outputPaths?: ReadonlyArray<string>
}

// ── Name Validation ──

const TOOL_NAME_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/

export function validateToolName(name: string): boolean {
  return TOOL_NAME_RE.test(name)
}

// ── JSON Schema from tool ──

export function toolToJsonSchema(tool: AnyTool): JsonSchema {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }
}

// ── Structured Output (借鉴 opencode - session/prompt.ts STRUCTURED_OUTPUT_*) ──

/**
 * 借鉴 opencode - StructuredOutput 工具
 * 用于强制 LLM 在最后一轮调用此工具返回结构化答案(由 Zod schema 验证)。
 * 失败时由 runtime 重试。
 */
export function structuredOutputTool<T>(
  name: string,
  schema: import("zod").ZodType<T>,
  description = "Return final structured response",
): Tool<unknown, T> & { readonly zodSchema: import("zod").ZodType<T> } {
  return Object.freeze({
    name,
    description,
    inputSchema: { type: "object" } as JsonSchema, // Zod schema is the real validator
    outputSchema: { type: "object" } as JsonSchema,
    zodSchema: schema,
    execute: async (input: unknown): Promise<T> => schema.parse(input),
  })
}

/**
 * 借鉴 opencode - 检查 LLM 是否调用了 StructuredOutput 工具
 * 用于检测 plan 评审、最终决策等关键节点是否已完成。
 */
export function isStructuredOutputCall(
  toolName: string,
  expectedName: string,
): boolean {
  return toolName === expectedName
}
