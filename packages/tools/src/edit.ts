// Edit tool — edit files with string replacement
// Derived from OpenCode packages/core/src/tool/edit.ts
// Plain TypeScript, no Effect-TS

import { makeTool, type ToolContent, ToolKind } from "@max/llm"
import { writeFile, stat } from "node:fs/promises"
import { resolve } from "node:path"
import { readEditableText } from "./editable-file.js"

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

export const editTool = makeTool<EditInput, EditOutput>({
  name: "edit",
  description:
    "Replace a string in a file. The old string must appear exactly once (unless replaceAll is true).",
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

    // Gate before matching: a file whose bytes are not valid UTF-8 must
    // never be rewritten as text (see editable-file.ts).
    const content = await readEditableText(filePath)
    const occurrences = countOccurrences(content, input.oldString)

    if (occurrences === 0) {
      throw new Error(`oldString not found in ${filePath}`)
    }
    if (occurrences > 1 && !input.replaceAll) {
      throw new Error(
        `oldString found ${occurrences} times in ${filePath}. Use replaceAll=true or provide a more specific string.`,
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
    return [
      { type: "text", text: `Edited ${output.target}: ${output.replacements} replacement(s)` },
    ]
  },
})
