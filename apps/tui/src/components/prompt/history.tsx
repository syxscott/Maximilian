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

import { useCallback, useEffect, useRef, useState } from "react"
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

export const { use: usePromptHistory, provider: PromptHistoryProvider } = createSimpleContext<
  PromptHistoryValue,
  Record<string, never>
>({
  name: "PromptHistory",
  init: () => {
    const paths = useTuiPaths()
    const historyPath = path.join(paths.state, "prompt-history.jsonl")
    const [state, setState] = useState<HistoryState>({ index: 0, history: [] })
    // Synchronous mirror of `state`: mutators can fire several times within
    // one render tick (rapid arrow-key recalls, submit right after recall)
    // and useState commits are async — reading render-closure state there
    // loses updates. The ref is advanced eagerly in commit() and kept in
    // step everywhere state changes.
    const stateRef = useRef(state)
    const commit = useCallback((next: HistoryState) => {
      stateRef.current = next
      setState(next)
    }, [])

    useEffect(() => {
      let cancelled = false
      void readText(historyPath).then((text) => {
        if (cancelled) return
        const lines = parsePromptHistory(text)
        commit({ ...stateRef.current, history: lines })
        // Self-heal on load: rewrite any retained entries so corruption is
        // trimmed and the limit is enforced.
        if (lines.length > 0) {
          void writeText(
            historyPath,
            lines.map((line) => JSON.stringify(line)).join("\n") + "\n",
          ).catch(() => {})
        }
      })
      return () => {
        cancelled = true
      }
    }, [historyPath, commit])

    const move = useCallback(
      (direction: 1 | -1, input: string): PromptInfo | undefined => {
        // Read the ref, not the render closure: the returned entry must
        // reflect every move() that already ran in this render tick.
        const { index, history } = stateRef.current
        const current = history.at(index)
        if (!current) return undefined
        if (current.input !== input && input.length) return undefined
        const nextIndex = index + direction
        if (Math.abs(nextIndex) > history.length) return current
        if (nextIndex > 0) return current
        commit({ index: nextIndex, history })
        return nextIndex === 0 ? { input: "", parts: [] } : history.at(nextIndex)
      },
      [commit],
    )

    const append = useCallback(
      (item: PromptInfo) => {
        // Compute from the ref and persist OUTSIDE any setState updater —
        // an updater can run twice (Strict Mode) or be skipped (concurrent
        // rendering), which would duplicate or drop the disk write.
        const entry = structuredClone(item)
        const { history } = stateRef.current
        if (isDuplicateEntry(history.at(-1), entry)) {
          commit({ index: 0, history })
          return
        }
        const nextHistory = [...history, entry]
        let trimmed = false
        if (nextHistory.length > MAX_HISTORY_ENTRIES) {
          nextHistory.splice(0, nextHistory.length - MAX_HISTORY_ENTRIES)
          trimmed = true
        }
        commit({ history: nextHistory, index: 0 })
        if (trimmed) {
          void writeText(
            historyPath,
            nextHistory.map((line) => JSON.stringify(line)).join("\n") + "\n",
          ).catch(() => {})
        } else {
          void appendText(historyPath, JSON.stringify(entry) + "\n").catch(() => {})
        }
      },
      [historyPath, commit],
    )

    return { move, append }
  },
})
