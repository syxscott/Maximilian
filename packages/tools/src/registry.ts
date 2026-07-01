// Tool registry — manages tool registration and execution
// Derived from OpenCode packages/core/src/tool/registry.ts
// Plain TypeScript, no Effect-TS

import type { ToolDefinition, ToolContent, ToolOutput } from "@max/llm"
import { toToolDefinition, type Tool, type AnyTool, type ToolExecuteContext, type ToolSettlement, validateToolName, ToolFailure } from "@max/llm"
import { makeTextPart } from "@max/llm"

// ── Registration ──

export interface Registration {
  readonly tool: AnyTool
  readonly scope?: string
}

// ── Execute Input ──

export interface ExecuteInput {
  readonly sessionID: string
  readonly agent: string
  readonly assistantMessageID: string
  readonly call: {
    readonly id: string
    readonly name: string
    readonly input: unknown
  }
}

// ── Materialization ──

export interface Materialization {
  readonly definitions: ToolDefinition[]
  readonly settle: (input: ExecuteInput) => Promise<Settlement>
}

export interface Settlement {
  readonly result: unknown
  readonly output?: ToolOutput
  readonly outputPaths?: ReadonlyArray<string>
}

// ── Registry Interface ──

export interface ToolRegistry {
  register(tools: Record<string, AnyTool>, scope?: string): void
  unregister(scope: string): void
  materialize(): Materialization
  has(name: string): boolean
  get(name: string): AnyTool | undefined
  list(): string[]
}

// ── Implementation ──

export function createToolRegistry(): ToolRegistry {
  // Application-level tools (global)
  const appTools = new Map<string, AnyTool>()
  // Scoped tools (e.g., per-session)
  const scopedTools = new Map<string, Map<string, AnyTool>>()

  function allTools(): Map<string, AnyTool> {
    const merged = new Map(appTools)
    for (const [_scope, tools] of scopedTools) {
      for (const [name, tool] of tools) {
        merged.set(name, tool)
      }
    }
    return merged
  }

  return {
    register(tools: Record<string, AnyTool>, scope?: string): void {
      for (const [name, tool] of Object.entries(tools)) {
        if (!validateToolName(name)) {
          throw new Error(`Invalid tool name: "${name}". Must match /^[A-Za-z][A-Za-z0-9_-]{0,63}$/`)
        }
        if (scope) {
          if (!scopedTools.has(scope)) {
            scopedTools.set(scope, new Map())
          }
          scopedTools.get(scope)!.set(name, tool)
        } else {
          appTools.set(name, tool)
        }
      }
    },

    unregister(scope: string): void {
      scopedTools.delete(scope)
    },

    materialize(): Materialization {
      const tools = allTools()
      const definitions: ToolDefinition[] = []
      for (const tool of tools.values()) {
        definitions.push(toToolDefinition(tool))
      }

      const settle = async (input: ExecuteInput): Promise<Settlement> => {
        const { call } = input
        const tool = tools.get(call.name)
        if (!tool) {
          throw new ToolFailure({ message: `Tool "${call.name}" not found` })
        }

        if (!tool.execute) {
          throw new ToolFailure({ message: `Tool "${call.name}" has no execute function` })
        }

        const context: ToolExecuteContext = {
          sessionID: input.sessionID,
          agent: input.agent,
          assistantMessageID: input.assistantMessageID,
          toolCallID: call.id,
        }

        try {
          const result = await tool.execute(call.input, context)
          const output = tool.toModelOutput
            ? { structured: result, content: tool.toModelOutput(result) }
            : { structured: result, content: [{ type: "text" as const, text: String(result) }] }
          return { result, output }
        } catch (error) {
          if (error instanceof ToolFailure) {
            return { result: { error: error.message }, output: { structured: { error: error.message }, content: [] } }
          }
          const message = error instanceof Error ? error.message : String(error)
          return { result: { error: message }, output: { structured: { error: message }, content: [] } }
        }
      }

      return { definitions, settle }
    },

    has(name: string): boolean {
      return allTools().has(name)
    },

    get(name: string): AnyTool | undefined {
      return allTools().get(name)
    },

    list(): string[] {
      return [...allTools().keys()]
    },
  }
}
