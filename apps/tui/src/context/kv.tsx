/**
 * Persistent key-value store used for user preferences (theme, recent
 * sessions, etc.) backed by a JSON file under the TUI's `state` directory.
 *
 * Ported from OpenCode's SolidJS `kv.tsx`. Solid relied on `createSignal`
 * for `ready` plus `createStore` for the value; we model both with React
 * `useState`. Writes are queued so rapid updates persist in order and the
 * final value is what hits disk.
 *
 * The file lock (`Flock.withLock`) is dropped here because Maximilian doesn't
 * ship that utility; concurrent processes sharing the same state file are
 * out of scope for this port.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import path from "node:path"
import { createSimpleContext } from "./helper"
import { useTuiPaths } from "./runtime"

type Setter<T> = T | ((prev: T) => T)

async function readJson<T>(file: string): Promise<T> {
  const fs = await import("node:fs/promises")
  const text = await fs.readFile(file, "utf8")
  return JSON.parse(text) as T
}

async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  const fs = await import("node:fs/promises")
  const tmp = `${file}.tmp`
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), "utf8")
  await fs.rename(tmp, file)
}

type KvValue = {
  ready: boolean
  store: Record<string, unknown>
  signal: <T>(name: string, defaultValue: T) => readonly [() => T, (next: Setter<T>) => void]
  get: <T = unknown>(key: string, defaultValue?: T) => T | undefined
  set: (key: string, value: unknown) => void
}

export const { use: useKV, provider: KVProvider } = createSimpleContext<KvValue, Record<string, never>>({
  name: "KV",
  init: () => {
    const paths = useTuiPaths()
    const file = path.join(paths.state, "kv.json")
    const [ready, setReady] = useState(false)
    const [store, setStore] = useState<Record<string, unknown>>({})

    useEffect(() => {
      let cancelled = false
      void readJson<Record<string, unknown>>(file)
        .then((value) => {
          if (!cancelled) setStore(value ?? {})
        })
        .catch((error) => {
          // Missing or corrupted file is treated as an empty store; log so
          // operators can still debug.
          console.error("Failed to read KV state", { error })
        })
        .finally(() => {
          if (!cancelled) setReady(true)
        })
      return () => {
        cancelled = true
      }
    }, [file])

    // Serialise writes so rapid updates persist in order.
    // Use a ref so the queue persists across re-renders (init() is called
    // every render by createSimpleContext).
    const writeQueueRef = useRef<Promise<unknown>>(Promise.resolve())

    const persist = useCallback(
      (snapshot: Record<string, unknown>) => {
        writeQueueRef.current = writeQueueRef.current
          .then(() => writeJsonAtomic(file, snapshot))
          .catch((error) => {
            console.error("Failed to write KV state", { error })
          })
        return writeQueueRef.current
      },
      [file],
    )

    const set = useCallback(
      (key: string, value: unknown) => {
        setStore((prev) => {
          const next = { ...prev, [key]: value }
          void persist(next)
          return next
        })
      },
      [persist],
    )

    const get = useCallback(
      <T = unknown,>(key: string, defaultValue?: T): T | undefined => {
        const value = store[key]
        return (value as T | undefined) ?? defaultValue
      },
      [store],
    )

    const signal = useCallback(
      <T,>(name: string, defaultValue: T) => {
        if (store[name] === undefined) {
          set(name, defaultValue as unknown)
        }
        const getter = () => store[name] as T
        const setter = (next: Setter<T>) => {
          setStore((prev) => {
            const previous = prev[name] as T | undefined
            const resolved =
              typeof next === "function" ? (next as (p: T | undefined) => T)(previous) : next
            const merged = { ...prev, [name]: resolved }
            void persist(merged)
            return merged
          })
        }
        return [getter, setter] as const
      },
      [store, persist, set],
    )

    return {
      ready,
      store,
      signal,
      get,
      set,
    }
  },
})
