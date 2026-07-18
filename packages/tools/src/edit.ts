// Edit tool — edit files with string replacement
// Derived from OpenCode packages/core/src/tool/edit.ts
// Plain TypeScript, no Effect-TS

import { makeTool, type ToolContent, ToolKind } from "@max/llm"
import { readFile, writeFile, stat } from "node:fs/promises"
import { resolve } from "node:path"

export interface EditInput {
  path: string
  oldString: string
  newString: string
  replaceAll?: boolean
}

export interface EditOutput {
  operation: "edit"
  target: string
  existed: boolean
  replacements: number
}

function countOccurrences(text: string, search: string): number {
  if (search.length === 0) return 0
  let count = 0
  let pos = 0
  while ((pos = text.indexOf(search, pos)) !== -1) {
    count++
    pos += search.length
  }
  return count
}

function _previewLines(oldText: string, newText: string, contextLines = 3): string {
  const oldLines = oldText.split("\n")
  const newLines = newText.split("\n")
  const preview: string[] = []
  // Show contextLines lines from the start of each
  const end = Math.min(oldLines.length, contextLines)
  for (let i = 0; i < end; i++) {
    preview.push(`- ${oldLines[i]}`)
  }
  for (let i = 0; i < Math.min(newLines.length, contextLines); i++) {
    preview.push(`+ ${newLines[i]}`)
  }
  return preview.join("\n")
}

export const editTool = makeTool<EditInput, EditOutput>({
  name: "edit",
  description: "Replace a string in a file. The old string must appear exactly once (unless replaceAll is true).",
  kind: ToolKind.Edit,
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path to the file" },
      oldString: { type: "string", description: "String to replace" },
      newString: { type: "string", description: "Replacement string" },
      replaceAll: { type: "boolean", description: "Replace all occurrences (default: false)" },
    },
    required: ["path", "oldString", "newString"],
  },
  async execute(input) {
    if (input.oldString === input.newString) {
      throw new Error("oldString and newString must be different")
    }
    if (input.oldString.length === 0) {
      throw new Error("oldString must not be empty")
    }

    const filePath = resolve(input.path)
    let existed = false
    try {
      await stat(filePath)
      existed = true
    } catch {
      throw new Error(`File not found: ${filePath}`)
    }

    const content = await readFile(filePath, "utf-8")
    const occurrences = countOccurrences(content, input.oldString)

    if (occurrences === 0) {
      throw new Error(`oldString not found in ${filePath}`)
    }
    if (occurrences > 1 && !input.replaceAll) {
      throw new Error(
        `oldString found ${occurrences} times in ${filePath}. Use replaceAll=true or provide a more specific string.`
      )
    }

    const newContent = input.replaceAll
      ? content.replaceAll(input.oldString, input.newString)
      : content.replace(input.oldString, input.newString)

    const replacements = input.replaceAll ? occurrences : 1
    await writeFile(filePath, newContent, "utf-8")

    return {
      operation: "edit" as const,
      target: filePath,
      existed,
      replacements,
    }
  },
  toModelOutput(output): ToolContent[] {
    return [{ type: "text", text: `Edited ${output.target}: ${output.replacements} replacement(s)` }]
  },
})
