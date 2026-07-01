/**
 * Prompt history: JSONL-backed log of previously submitted prompts that the
 * user can navigate through with arrow keys.
 *
 * Ported from OpenCode's SolidJS `prompt/history.tsx`. The original used a
 * Solid `createStore` plus `produce` mutations; we mirror that with React
 * `useState` and treat the array as immutable from the consumer's view.
 *
 * Persistence helpers (`appendText`/`readText`/`writeText`) are inlined
 * here against `node:fs/promises` since Maximilian doesn't yet ship that
 * util module.
 */

import { useCallback, useEffect, useState } from "react"
import path from "node:path"
import { createSimpleContext } from "../../context/helper"
import { useTuiPaths } from "../../context/runtime"

type AgentPart = Record<string, unknown>
type FilePart = Record<string, unknown>
type TextPart = Record<string, unknown> & {
  source?: {
    text: { start: number; end: number; value: string }
  }
}

export type PromptInfo = {
  input: string
  mode?: "normal" | "shell"
  parts: (
    | Omit<FilePart, "id" | "messageID" | "sessionID">
    | Omit<AgentPart, "id" | "messageID" | "sessionID">
    | (Omit<TextPart, "id" | "messageID" | "sessionID"> & {
        source?: {
          text: {
            start: number
            end: number
            value: string
          }
        }
      })
  )[]
}

export const MAX_HISTORY_ENTRIES = 50

export function parsePromptHistory(text: string): PromptInfo[] {
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as PromptInfo
      } catch {
        return undefined
      }
    })
    .filter((line): line is PromptInfo => line !== undefined)
    .slice(-MAX_HISTORY_ENTRIES)
}

export function isDuplicateEntry(previous: PromptInfo | undefined, next: PromptInfo): boolean {
  if (!previous) return false
  return JSON.stringify(previous) === JSON.stringify(next)
}

async function readText(file: string): Promise<string> {
  const fs = await import("node:fs/promises")
  try {
    return await fs.readFile(file, "utf8")
  } catch {
    return ""
  }
}

async function appendText(file: string, chunk: string): Promise<void> {
  const fs = await import("node:fs/promises")
  await fs.appendFile(file, chunk, "utf8")
}

async function writeText(file: string, content: string): Promise<void> {
  const fs = await import("node:fs/promises")
  await fs.writeFile(file, content, "utf8")
}

type HistoryState = {
  index: number
  history: PromptInfo[]
}

type PromptHistoryValue = {
  move: (direction: 1 | -1, input: string) => PromptInfo | undefined
  append: (item: PromptInfo) => void
}

export const { use: usePromptHistory, provider: PromptHistoryProvider } = createSimpleContext<PromptHistoryValue, Record<string, never>>({
  name: "PromptHistory",
  init: () => {
    const paths = useTuiPaths()
    const historyPath = path.join(paths.state, "prompt-history.jsonl")
    const [state, setState] = useState<HistoryState>({ index: 0, history: [] })

    useEffect(() => {
      let cancelled = false
      void readText(historyPath).then((text) => {
        if (cancelled) return
        const lines = parsePromptHistory(text)
        setState((prev) => ({ ...prev, history: lines }))
        // Self-heal on load: rewrite any retained entries so corruption is
        // trimmed and the limit is enforced.
        if (lines.length > 0) {
          void writeText(historyPath, lines.map((line) => JSON.stringify(line)).join("\n") + "\n").catch(() => {})
        }
      })
      return () => {
        cancelled = true
      }
    }, [historyPath])

    const move = useCallback(
      (direction: 1 | -1, input: string): PromptInfo | undefined => {
        const current = state.history.at(state.index)
        if (!current) return undefined
        if (current.input !== input && input.length) return
        setState((prev) => {
          const next = prev.index + direction
          if (Math.abs(next) > prev.history.length) return prev
          if (next > 0) return prev
          return { ...prev, index: next }
        })
        if (state.index === 0) return { input: "", parts: [] }
        return state.history.at(state.index)
      },
      [state],
    )

    const append = useCallback(
      (item: PromptInfo) => {
        const entry = structuredClone(item)
        setState((prev) => {
          if (isDuplicateEntry(prev.history.at(-1), entry)) {
            return { ...prev, index: 0 }
          }
          let trimmed = false
          const nextHistory = [...prev.history, entry]
          if (nextHistory.length > MAX_HISTORY_ENTRIES) {
            nextHistory.splice(0, nextHistory.length - MAX_HISTORY_ENTRIES)
            trimmed = true
          }
          const final: HistoryState = { history: nextHistory, index: 0 }
          if (trimmed) {
            void writeText(historyPath, nextHistory.map((line) => JSON.stringify(line)).join("\n") + "\n").catch(
              () => {},
            )
          } else {
            void appendText(historyPath, JSON.stringify(entry) + "\n").catch(() => {})
          }
          return final
        })
      },
      [historyPath],
    )

    return { move, append }
  },
})
