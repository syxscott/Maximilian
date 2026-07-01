// Grep tool — search file contents
// Derived from OpenCode packages/core/src/tool/grep.ts
// Plain TypeScript, no Effect-TS

import { makeTool, type ToolContent } from "@max/llm"
import { readFile, stat, readdir } from "node:fs/promises"
import { resolve, relative, join } from "node:path"

export interface GrepInput {
  pattern: string
  path?: string
  include?: string
  limit?: number
}

export interface GrepOutput {
  matches: Array<{
    path: string
    line: number
    text: string
  }>
}

const MAX_FILE_SIZE = 1024 * 1024 // 1MB

async function searchFile(filePath: string, regex: RegExp): Promise<Array<{ line: number; text: string }>> {
  try {
    const fileStat = await stat(filePath)
    if (fileStat.size > MAX_FILE_SIZE) return []
    const content = await readFile(filePath, "utf-8")
    const lines = content.split("\n")
    const matches: Array<{ line: number; text: string }> = []
    for (let i = 0; i < lines.length; i++) {
      if (regex.test(lines[i])) {
        matches.push({ line: i + 1, text: lines[i].trim() })
      }
    }
    return matches
  } catch {
    return []
  }
}

async function walkDir(dir: string, maxFiles: number): Promise<string[]> {
  const results: string[] = []
  const stack = [dir]

  while (stack.length > 0 && results.length < maxFiles) {
    const current = stack.pop()!
    try {
      const entries = await readdir(current, { withFileTypes: true })
      for (const entry of entries) {
        if (results.length >= maxFiles) break
        const fullPath = join(current, entry.name)
        if (entry.isDirectory()) {
          if (!entry.name.startsWith(".") && entry.name !== "node_modules") {
            stack.push(fullPath)
          }
        } else {
          results.push(fullPath)
        }
      }
    } catch {
      // Skip unreadable directories
    }
  }

  return results
}

export const grepTool = makeTool<GrepInput, GrepOutput>({
  name: "grep",
  description: "Search for a pattern in file contents. Returns matching lines with file paths and line numbers.",
  inputSchema: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Regex pattern to search for" },
      path: { type: "string", description: "File or directory to search in (default: current directory)" },
      include: { type: "string", description: "Glob pattern to filter files (e.g. '*.ts')" },
      limit: { type: "number", description: "Maximum number of results (default: 100)" },
    },
    required: ["pattern"],
  },
  async execute(input) {
    const target = resolve(input.path ?? process.cwd())
    const limit = input.limit ?? 100
    const regex = new RegExp(input.pattern, "gi")

    const targetStat = await stat(target)
    let files: string[]

    if (targetStat.isFile()) {
      files = [target]
    } else {
      files = await walkDir(target, 1000)
      if (input.include) {
        const includeRegex = new RegExp(
          "^" + input.include.replace(/\./g, "\\.").replace(/\*/g, ".*").replace(/\?/g, ".") + "$"
        )
        files = files.filter((f) => includeRegex.test(f.split("/").pop() ?? ""))
      }
    }

    const allMatches: GrepOutput["matches"] = []
    for (const file of files) {
      if (allMatches.length >= limit) break
      const fileMatches = await searchFile(file, regex)
      const relPath = relative(target, file)
      for (const m of fileMatches) {
        if (allMatches.length >= limit) break
        allMatches.push({ path: relPath || file, line: m.line, text: m.text })
      }
    }

    return { matches: allMatches }
  },
  toModelOutput(output): ToolContent[] {
    if (output.matches.length === 0) {
      return [{ type: "text", text: "No matches found." }]
    }
    const grouped = new Map<string, typeof output.matches>()
    for (const m of output.matches) {
      if (!grouped.has(m.path)) grouped.set(m.path, [])
      grouped.get(m.path)!.push(m)
    }
    const lines: string[] = []
    for (const [path, matches] of grouped) {
      lines.push(path)
      for (const m of matches) {
        lines.push(`  Line ${m.line}: ${m.text}`)
      }
    }
    return [{ type: "text", text: lines.join("\n") }]
  },
})
