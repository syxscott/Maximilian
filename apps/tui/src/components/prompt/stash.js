/**
 * Prompt stash: JSONL-backed log of stashed prompts (snapshots of partially
 * composed input the user wants to set aside and return to later).
 *
 * Ported from OpenCode's SolidJS `prompt/stash.tsx`. Same persistence pattern
 * as `history.tsx`: each append is a JSON line, and any time the list is
 * trimmed past the cap we rewrite the file in full.
 */
import { useCallback, useEffect, useRef, useState } from "react"
import path from "node:path"
import { createSimpleContext } from "../../context/helper"
import { useTuiPaths } from "../../context/runtime"
export const MAX_STASH_ENTRIES = 50
export function parsePromptStash(text) {
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return undefined
      }
    })
    .filter((line) => line !== undefined)
    .slice(-MAX_STASH_ENTRIES)
}
async function readText(file) {
  const fs = await import("node:fs/promises")
  try {
    return await fs.readFile(file, "utf8")
  } catch {
    return ""
  }
}
async function appendText(file, chunk) {
  const fs = await import("node:fs/promises")
  await fs.appendFile(file, chunk, "utf8")
}
async function writeText(file, content) {
  const fs = await import("node:fs/promises")
  await fs.writeFile(file, content, "utf8")
}
export const { use: usePromptStash, provider: PromptStashProvider } = createSimpleContext({
  name: "PromptStash",
  init: () => {
    const paths = useTuiPaths()
    const stashPath = path.join(paths.state, "prompt-stash.jsonl")
    const [entries, setEntries] = useState([])
    // Synchronous mirror of `entries`: push/pop/remove can fire several
    // times within one render tick, and useState commits are async — a
    // render-closure read would return the same top entry twice and lose
    // the intermediate mutations.
    const entriesRef = useRef(entries)
    const commitEntries = useCallback((next) => {
      entriesRef.current = next
      setEntries(next)
    }, [])
    useEffect(() => {
      let cancelled = false
      void readText(stashPath).then((text) => {
        if (cancelled) return
        const lines = parsePromptStash(text)
        commitEntries(lines)
        if (lines.length > 0) {
          void writeText(
            stashPath,
            lines.map((line) => JSON.stringify(line)).join("\n") + "\n",
          ).catch(() => {})
        }
      })
      return () => {
        cancelled = true
      }
    }, [stashPath, commitEntries])
    const persist = (next) => {
      if (next.length === 0) {
        void writeText(stashPath, "").catch(() => {})
      } else {
        void writeText(stashPath, next.map((line) => JSON.stringify(line)).join("\n") + "\n").catch(
          () => {},
        )
      }
    }
    const push = useCallback(
      (entry) => {
        const stash = { ...structuredClone(entry), timestamp: Date.now() }
        const next = [...entriesRef.current, stash]
        let trimmed = false
        if (next.length > MAX_STASH_ENTRIES) {
          next.splice(0, next.length - MAX_STASH_ENTRIES)
          trimmed = true
        }
        // Keep the disk write OUTSIDE any setState updater — an updater can
        // run twice (Strict Mode) or be skipped (concurrent rendering).
        commitEntries(next)
        if (trimmed) {
          persist(next)
        } else {
          void appendText(stashPath, JSON.stringify(stash) + "\n").catch(() => {})
        }
      },
      [stashPath, commitEntries],
    )
    const pop = useCallback(() => {
      // Snapshot from the ref: consecutive pops in one tick must each return
      // the then-current top entry, even though React state hasn't committed.
      const snapshot = entriesRef.current[entriesRef.current.length - 1]
      if (!snapshot) return undefined
      const next = entriesRef.current.slice(0, -1)
      commitEntries(next)
      persist(next)
      return snapshot
    }, [commitEntries])
    const remove = useCallback(
      (index) => {
        const prev = entriesRef.current
        if (index < 0 || index >= prev.length) return
        const next = [...prev]
        next.splice(index, 1)
        commitEntries(next)
        persist(next)
      },
      [commitEntries],
    )
    return {
      list: () => entries,
      push,
      pop,
      remove,
    }
  },
})
