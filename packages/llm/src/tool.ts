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
