/**
 * Prompt stash: JSONL-backed log of stashed prompts (snapshots of partially
 * composed input the user wants to set aside and return to later).
 *
 * Ported from OpenCode's SolidJS `prompt/stash.tsx`. Same persistence pattern
 * as `history.tsx`: each append is a JSON line, and any time the list is
 * trimmed past the cap we rewrite the file in full.
 */

import { useCallback, useEffect, useState } from "react"
import path from "node:path"
import { createSimpleContext } from "../../context/helper"
import { useTuiPaths } from "../../context/runtime"
import type { PromptInfo } from "./history"

export type StashEntry = {
  input: string
  parts: PromptInfo["parts"]
  timestamp: number
}

export const MAX_STASH_ENTRIES = 50

export function parsePromptStash(text: string): StashEntry[] {
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as StashEntry
      } catch {
        return undefined
      }
    })
    .filter((line): line is StashEntry => line !== undefined)
    .slice(-MAX_STASH_ENTRIES)
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

type PromptStashValue = {
  list: () => StashEntry[]
  push: (entry: Omit<StashEntry, "timestamp">) => void
  pop: () => StashEntry | undefined
  remove: (index: number) => void
}

export const { use: usePromptStash, provider: PromptStashProvider } = createSimpleContext<PromptStashValue, Record<string, never>>({
  name: "PromptStash",
  init: () => {
    const paths = useTuiPaths()
    const stashPath = path.join(paths.state, "prompt-stash.jsonl")
    const [entries, setEntries] = useState<StashEntry[]>([])

    useEffect(() => {
      let cancelled = false
      void readText(stashPath).then((text) => {
        if (cancelled) return
        const lines = parsePromptStash(text)
        setEntries(lines)
        if (lines.length > 0) {
          void writeText(stashPath, lines.map((line) => JSON.stringify(line)).join("\n") + "\n").catch(() => {})
        }
      })
      return () => {
        cancelled = true
      }
    }, [stashPath])

    const persist = (next: StashEntry[]) => {
      if (next.length === 0) {
        void writeText(stashPath, "").catch(() => {})
      } else {
        void writeText(stashPath, next.map((line) => JSON.stringify(line)).join("\n") + "\n").catch(() => {})
      }
    }

    const push = useCallback(
      (entry: Omit<StashEntry, "timestamp">) => {
        const stash: StashEntry = { ...structuredClone(entry), timestamp: Date.now() }
        setEntries((prev) => {
          let trimmed = false
          const next = [...prev, stash]
          if (next.length > MAX_STASH_ENTRIES) {
            next.splice(0, next.length - MAX_STASH_ENTRIES)
            trimmed = true
          }
          if (trimmed) {
            persist(next)
          } else {
            void appendText(stashPath, JSON.stringify(stash) + "\n").catch(() => {})
          }
          return next
        })
      },
      [stashPath],
    )

    const pop = useCallback((): StashEntry | undefined => {
      // Snapshot the entry synchronously BEFORE dispatching the state
      // update — the previous implementation captured `popped` inside
      // a setEntries updater, which React Strict Mode runs twice, so
      // the second invocation could see an empty array and clobber
      // the snapshot with `undefined`. The outer state had already
      // been mutated by the first run, losing the popped entry.
      const snapshot = entries[entries.length - 1]
      if (!snapshot) return undefined
      const next = entries.slice(0, -1)
      setEntries(next)
      persist(next)
      return snapshot
    }, [entries, persist])

    const remove = useCallback(
      (index: number) => {
        setEntries((prev) => {
          if (index < 0 || index >= prev.length) return prev
          const next = [...prev]
          next.splice(index, 1)
          persist(next)
          return next
        })
      },
      [stashPath],
    )

    return {
      list: () => entries,
      push,
      pop,
      remove,
    }
  },
})
