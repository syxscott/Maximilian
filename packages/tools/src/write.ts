// Write tool — write files
// Derived from OpenCode packages/core/src/tool/write.ts
// Plain TypeScript, no Effect-TS

import { makeTool, type ToolContent, ToolKind } from "@max/llm"
import { writeFile, stat, mkdir } from "node:fs/promises"
import { resolve, dirname } from "node:path"

export interface WriteInput {
  path: string
  content: string
}

export interface WriteOutput {
  operation: "write"
  target: string
  existed: boolean
}

export const writeTool = makeTool<WriteInput, WriteOutput>({
  name: "write",
  description: "Write content to a file. Creates parent directories if needed.",
  kind: ToolKind.Edit,
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path to the file to write" },
      content: { type: "string", description: "Content to write" },
    },
    required: ["path", "content"],
  },
  async execute(input) {
    const filePath = resolve(input.path)
    let existed = false
    try {
      await stat(filePath)
      existed = true
    } catch {
      // File doesn't exist
    }

    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, input.content, "utf-8")

    return {
      operation: "write" as const,
      target: filePath,
      existed,
    }
  },
  toModelOutput(output): ToolContent[] {
    const msg = output.existed ? `Overwrote ${output.target}` : `Created ${output.target}`
    return [{ type: "text", text: msg }]
  },
})
