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
async function readJson(file) {
  const fs = await import("node:fs/promises")
  const text = await fs.readFile(file, "utf8")
  try {
    return JSON.parse(text)
  } catch {
    // Corrupted JSON — treat as empty store rather than crashing the init.
    return {}
  }
}
async function writeJsonAtomic(file, value) {
  const fs = await import("node:fs/promises")
  const tmp = `${file}.tmp`
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), "utf8")
  try {
    await fs.rename(tmp, file)
  } catch (err) {
    // Best-effort: on rename failure, try direct copy as fallback before propagating.
    try {
      await fs.copyFile(tmp, file)
      await fs.unlink(tmp)
    } catch {
      // Surface the original rename error.
      throw err
    }
  }
}
export const { use: useKV, provider: KVProvider } = createSimpleContext({
  name: "KV",
  init: () => {
    const paths = useTuiPaths()
    const file = path.join(paths.state, "kv.json")
    const [ready, setReady] = useState(false)
    const [store, setStore] = useState({})
    useEffect(() => {
      let cancelled = false
      void readJson(file)
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
    const writeQueueRef = useRef(Promise.resolve())
    const persist = useCallback(
      (snapshot) => {
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
      (key, value) => {
        setStore((prev) => {
          const next = { ...prev, [key]: value }
          void persist(next)
          return next
        })
      },
      [persist],
    )
    const get = useCallback(
      (key, defaultValue) => {
        const value = store[key]
        return value ?? defaultValue
      },
      [store],
    )
    const signal = useCallback(
      (name, defaultValue) => {
        if (store[name] === undefined) {
          set(name, defaultValue)
        }
        // Track the live value in a ref so the getter returns the most
        // recent write in the common case, not the value from whichever
        // render closure captured `store`. Limitation: React only runs
        // the setStore updater eagerly when no update is queued — with
        // updates pending, liveRef.current stays stale until commit, so
        // getter() after setter() is not a hard read-your-writes
        // guarantee. Treat the ref as best-effort freshness only.
        const liveRef = { current: store[name] ?? defaultValue }
        const getter = () => liveRef.current
        const setter = (next) => {
          setStore((prev) => {
            const previous = prev[name]
            const resolved = typeof next === "function" ? next(previous) : next
            liveRef.current = resolved
            const merged = { ...prev, [name]: resolved }
            void persist(merged)
            return merged
          })
        }
        return [getter, setter]
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
