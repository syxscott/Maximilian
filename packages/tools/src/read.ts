// Read tool — read files and directories
// Derived from OpenCode packages/core/src/tool/read.ts
// Plain TypeScript, no Effect-TS

import { makeTool, type ToolContent, ToolKind } from "@max/llm"
import { readFile, readdir, stat } from "node:fs/promises"
import { resolve } from "node:path"

export interface ReadInput {
  path: string
  offset?: number
  limit?: number
}

export type ReadOutput = FileContent | DirectoryListing

export interface FileContent {
  type: "file"
  path: string
  content: string
  totalLines: number
  truncated: boolean
  /** Starting line number (1-based) for numbered output */
  startLine: number
}

export interface DirectoryListing {
  type: "directory"
  path: string
  entries: Array<{ name: string; type: "file" | "directory" | "symlink" }>
}

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB

export const readTool = makeTool<ReadInput, ReadOutput>({
  name: "read",
  description: "Read the contents of a file or list a directory.",
  kind: ToolKind.Read,
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path to the file or directory" },
      offset: { type: "number", description: "Line number to start reading from (0-based)" },
      limit: { type: "number", description: "Maximum number of lines to read" },
    },
    required: ["path"],
  },
  async execute(input) {
    const filePath = resolve(input.path)
    const fileStat = await stat(filePath)

    if (fileStat.isDirectory()) {
      const entries = await readdir(filePath, { withFileTypes: true })
      return {
        type: "directory" as const,
        path: filePath,
        entries: entries.map((e) => ({
          name: e.name,
          type: (e.isDirectory() ? "directory" : e.isSymbolicLink() ? "symlink" : "file") as
            | "file"
            | "directory"
            | "symlink",
        })),
      }
    }

    if (fileStat.size > MAX_FILE_SIZE) {
      throw new Error(`File too large (${(fileStat.size / 1024 / 1024).toFixed(1)}MB > 10MB limit)`)
    }

    const content = await readFile(filePath, "utf-8")
    const lines = content.split("\n")
    const totalLines = lines.length
    const offset = input.offset ?? 0
    const limit = input.limit ?? lines.length
    const sliced = lines.slice(offset, offset + limit)

    return {
      type: "file" as const,
      path: filePath,
      content: sliced.join("\n"),
      totalLines,
      truncated: offset + limit < totalLines,
      startLine: offset + 1, // 1-based line numbering
    }
  },
  toModelOutput(output): ToolContent[] {
    if (output.type === "directory") {
      const lines = output.entries.map((e) => `${e.type === "directory" ? "d" : "f"} ${e.name}`)
      return [{ type: "text", text: lines.join("\n") }]
    }
    const numbered = output.content
      .split("\n")
      .map((line, i) => `${output.startLine + i}\t${line}`)
      .join("\n")
    return [{ type: "text", text: numbered }]
  },
})
