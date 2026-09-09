// Glob tool — find files by glob pattern
// Derived from OpenCode packages/core/src/tool/glob.ts
// Plain TypeScript, no Effect-TS

import { makeTool, type ToolContent, ToolKind } from "@max/llm"
import { resolve, relative } from "node:path"
import { readdir } from "node:fs/promises"

export interface GlobInput {
  pattern: string
  path?: string
  limit?: number
}

export interface GlobOutput {
  files: Array<{ path: string }>
}

// Simple glob matching (supports *, **, ?)
function matchGlob(pattern: string, text: string): boolean {
  const regexStr = pattern
    .replace(/\./g, "\\.")
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/\{\{GLOBSTAR\}\}/g, ".*")
  return new RegExp(`^${regexStr}$`).test(text)
}

async function walkDir(dir: string, maxResults: number): Promise<string[]> {
  const results: string[] = []
  const stack = [dir]

  while (stack.length > 0 && results.length < maxResults) {
    const current = stack.pop()!
    try {
      const entries = await readdir(current, { withFileTypes: true })
      for (const entry of entries) {
        if (results.length >= maxResults) break
        const fullPath = resolve(current, entry.name)
        if (entry.isDirectory()) {
          // Skip node_modules and hidden dirs
          if (!entry.name.startsWith(".") && entry.name !== "node_modules") {
            stack.push(fullPath)
          }
        } else {
          results.push(fullPath)
        }
      }
    } catch {
      // Skip directories we can't read
    }
  }

  return results
}

export const globTool = makeTool<GlobInput, GlobOutput>({
  name: "glob",
  description: "Find files matching a glob pattern. Supports *, **, and ?.",
  kind: ToolKind.Search,
  inputSchema: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Glob pattern (e.g. '**/*.ts', 'src/**/*.tsx')" },
      path: { type: "string", description: "Directory to search in (default: current directory)" },
      limit: { type: "number", description: "Maximum number of results (default: 100)" },
    },
    required: ["pattern"],
  },
  async execute(input) {
    const cwd = resolve(input.path ?? process.cwd())
    const limit = input.limit ?? 100
    const allFiles = await walkDir(cwd, limit * 10) // get more to filter

    const matches = allFiles
      .map((f) => relative(cwd, f))
      .filter((rel) => matchGlob(input.pattern, rel))
      .slice(0, limit)
      .map((path) => ({ path }))

    return { files: matches }
  },
  toModelOutput(output): ToolContent[] {
    if (output.files.length === 0) {
      return [{ type: "text", text: "No files found." }]
    }
    return [{ type: "text", text: output.files.map((f) => f.path).join("\n") }]
  },
})
