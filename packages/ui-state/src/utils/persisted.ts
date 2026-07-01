/**
 * Ported from OpenCode packages/app/src/utils/persist.ts
 *
 * The OpenCode `persisted` helper accepts a SolidJS `[Store, SetStoreFunction]`
 * tuple and wraps it with a storage adapter. The React equivalent takes a
 * Zustand store and uses the `persist` middleware with custom storage to
 * replicate the same features:
 *
 *   - `name` / `key` (per-store namespace)
 *   - `storage` prefix (e.g. `opencode.global.dat`)
 *   - `legacy` keys (read from `default.dat` first, then migrate)
 *   - `migrate` function applied to the parsed value
 *   - LRU + size-bounded read cache to keep getItem fast
 *   - Quota-aware writes that evict the largest non-prefixed entries
 *
 * The shape is intentionally close to OpenCode's so consumers can use the
 * same `Persist.*` factory helpers and the same `removePersisted(target)`.
 */
import { persist, createJSONStorage, type StateStorage } from "zustand/middleware"
import { createStore, type StoreApi, type UseBoundStore } from "zustand"

export type PersistTarget = {
  storage?: string
  legacyStorageNames?: string[]
  key: string
  legacy?: string[]
  migrate?: (value: unknown) => unknown
}

export const LEGACY_STORAGE = "default.dat"
export const GLOBAL_STORAGE = "opencode.global.dat"
export const LOCAL_PREFIX = "opencode."

const CACHE_MAX_ENTRIES = 500
const CACHE_MAX_BYTES = 8 * 1024 * 1024

type CacheEntry = { value: string; bytes: number }
const cache = new Map<string, CacheEntry>()
const cacheTotal = { bytes: 0 }
const fallback = new Map<string, boolean>()

function cacheDelete(key: string) {
  const entry = cache.get(key)
  if (!entry) return
  cacheTotal.bytes -= entry.bytes
  cache.delete(key)
}

function cachePrune() {
  for (;;) {
    if (cache.size <= CACHE_MAX_ENTRIES && cacheTotal.bytes <= CACHE_MAX_BYTES) return
    const oldest = cache.keys().next().value as string | undefined
    if (!oldest) return
    cacheDelete(oldest)
  }
}

function cacheSet(key: string, value: string) {
  const bytes = value.length * 2
  if (bytes > CACHE_MAX_BYTES) {
    cacheDelete(key)
    return
  }
  const entry = cache.get(key)
  if (entry) cacheTotal.bytes -= entry.bytes
  cache.delete(key)
  cache.set(key, { value, bytes })
  cacheTotal.bytes += bytes
  cachePrune()
}

function cacheGet(key: string): string | undefined {
  const entry = cache.get(key)
  if (!entry) return
  cache.delete(key)
  cache.set(key, entry)
  return entry.value
}

function fallbackDisabled(scope: string) {
  return fallback.get(scope) === true
}

function fallbackSet(scope: string) {
  fallback.set(scope, true)
}

function quota(error: unknown): boolean {
  if (error instanceof DOMException) {
    if (error.name === "QuotaExceededError") return true
    if (error.name === "NS_ERROR_DOM_QUOTA_REACHED") return true
    if (error.name === "QUOTA_EXCEEDED_ERR") return true
    if (error.code === 22 || error.code === 1014) return true
    return false
  }
  if (!error || typeof error !== "object") return false
  const name = (error as { name?: string }).name
  if (name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED") return true
  if (name && /quota/i.test(name)) return true
  const code = (error as { code?: number }).code
  if (code === 22 || code === 1014) return true
  const message = (error as { message?: string }).message
  return typeof message === "string" && /quota/i.test(message)
}

type Evict = { key: string; size: number }

function evict(storage: Storage, keep: string, value: string): boolean {
  const total = storage.length
  const indexes = Array.from({ length: total }, (_, index) => index)
  const items: Evict[] = []
  for (const index of indexes) {
    const name = storage.key(index)
    if (!name) continue
    if (!name.startsWith(LOCAL_PREFIX)) continue
    if (name === keep) continue
    const stored = storage.getItem(name)
    items.push({ key: name, size: stored?.length ?? 0 })
  }
  items.sort((a, b) => b.size - a.size)
  for (const item of items) {
    storage.removeItem(item.key)
    cacheDelete(item.key)
    try {
      storage.setItem(keep, value)
      cacheSet(keep, value)
      return true
    } catch (error) {
      if (!quota(error)) throw error
    }
  }
  return false
}

function write(storage: Storage, key: string, value: string): boolean {
  try {
    storage.setItem(key, value)
    cacheSet(key, value)
    return true
  } catch (error) {
    if (!quota(error)) throw error
  }
  try {
    storage.removeItem(key)
    cacheDelete(key)
    storage.setItem(key, value)
    cacheSet(key, value)
    return true
  } catch (error) {
    if (!quota(error)) throw error
  }
  return evict(storage, key, value)
}

function snapshot<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function merge(defaults: unknown, value: unknown): unknown {
  if (value === undefined) return defaults
  if (value === null) return value
  if (Array.isArray(defaults)) {
    if (Array.isArray(value)) return value
    return defaults
  }
  if (isRecord(defaults)) {
    if (!isRecord(value)) return defaults
    const result: Record<string, unknown> = { ...defaults }
    for (const key of Object.keys(value)) {
      if (key in defaults) {
        result[key] = merge((defaults as Record<string, unknown>)[key], (value as Record<string, unknown>)[key])
      } else {
        result[key] = (value as Record<string, unknown>)[key]
      }
    }
    return result
  }
  return value
}

function parse(value: string): unknown {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return undefined
  }
}

function normalize(defaults: unknown, raw: string, migrate?: (value: unknown) => unknown) {
  const parsed = parse(raw)
  if (parsed === undefined) return
  const migrated = migrate ? migrate(parsed) : parsed
  const merged = merge(defaults, migrated)
  return JSON.stringify(merged)
}

function readCurrent(input: {
  storage: StateStorage
  key: string
  defaults: unknown
  migrate?: (value: unknown) => unknown
}): string | null | undefined {
  const raw = syncGet(input.storage, input.key)
  if (raw === null) return null
  const next = normalize(input.defaults, raw, input.migrate)
  if (next === undefined) {
    input.storage.removeItem(input.key)
    return null
  }
  if (raw !== next) input.storage.setItem(input.key, next)
  return next
}

function syncGet(storage: StateStorage, key: string): string | null {
  // Zustand v5's `StateStorage` allows async returns. The OpenCode helper
  // is sync-only; treat promise values as "not present" so the
  // `createJSONStorage` wrapper handles hydration asynchronously.
  const value = storage.getItem(key) as string | null | Promise<string | null>
  if (value === null) return null
  if (typeof value === "object" && value !== null && "then" in (value as unknown as Record<string, unknown>)) {
    return null
  }
  return value as string
}

function migrateLegacy(input: {
  current: StateStorage
  legacyStore: StateStorage
  stores: StateStorage[]
  keys: string[]
  key: string
  defaults: unknown
  migrate?: (value: unknown) => unknown
}): string | null {
  for (const store of input.stores) {
    const raw = syncGet(store, input.key)
    if (raw === null) continue
    const next = normalize(input.defaults, raw, input.migrate)
    if (next === undefined) {
      store.removeItem(input.key)
      continue
    }
    input.current.setItem(input.key, next)
    store.removeItem(input.key)
    return next
  }
  for (const key of input.keys) {
    const raw = syncGet(input.legacyStore, key)
    if (raw === null) continue
    const next = normalize(input.defaults, raw, input.migrate)
    if (next === undefined) {
      input.legacyStore.removeItem(key)
      continue
    }
    input.current.setItem(input.key, next)
    input.legacyStore.removeItem(key)
    return next
  }
  return null
}

function localStorageWithPrefix(prefix: string): StateStorage {
  const base = `${prefix}:`
  const scope = `prefix:${prefix}`
  const item = (key: string) => base + key
  return {
    getItem: (key) => {
      const name = item(key)
      const cached = cacheGet(name)
      if (fallbackDisabled(scope)) return cached ?? null
      const stored = (() => {
        try {
          return localStorage.getItem(name)
        } catch {
          fallbackSet(scope)
          return null
        }
      })()
      if (stored === null) return cached ?? null
      cacheSet(name, stored)
      return stored
    },
    setItem: (key, value) => {
      const name = item(key)
      if (fallbackDisabled(scope)) return
      try {
        if (write(localStorage, name, value)) return
      } catch {
        fallbackSet(scope)
        return
      }
      fallbackSet(scope)
    },
    removeItem: (key) => {
      const name = item(key)
      cacheDelete(name)
      if (fallbackDisabled(scope)) return
      try {
        localStorage.removeItem(name)
      } catch {
        fallbackSet(scope)
      }
    },
  }
}

function localStorageDirect(): StateStorage {
  const scope = "direct"
  return {
    getItem: (key) => {
      const cached = cacheGet(key)
      if (fallbackDisabled(scope)) return cached ?? null
      const stored = (() => {
        try {
          return localStorage.getItem(key)
        } catch {
          fallbackSet(scope)
          return null
        }
      })()
      if (stored === null) return cached ?? null
      cacheSet(key, stored)
      return stored
    },
    setItem: (key, value) => {
      if (fallbackDisabled(scope)) return
      try {
        if (write(localStorage, key, value)) return
      } catch {
        fallbackSet(scope)
        return
      }
      fallbackSet(scope)
    },
    removeItem: (key) => {
      cacheDelete(key)
      if (fallbackDisabled(scope)) return
      try {
        localStorage.removeItem(key)
      } catch {
        fallbackSet(scope)
      }
    },
  }
}

function undefinedStorage(): StateStorage {
  const map = new Map<string, string>()
  return {
    getItem: (k) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  }
}

function buildStorage(config: PersistTarget) {
  const isDesktop = false
  if (isDesktop) {
    // Desktop platform storage is wired by the host; for the web build we
    // fall through to the localStorage-backed implementations below.
  }
  const currentStorage = config.storage ? localStorageWithPrefix(config.storage) : localStorageDirect()
  const legacyStorage = localStorageDirect()
  const legacyStores = (config.legacyStorageNames ?? []).map(localStorageWithPrefix)
  const legacy = config.legacy ?? []

  return (): StateStorage => ({
    getItem: (key) => {
      const value = readCurrent({ storage: currentStorage, key, defaults: undefined, migrate: config.migrate })
      if (value !== undefined && value !== null) return value
      const migrated = migrateLegacy({
        current: currentStorage,
        legacyStore: legacyStorage,
        stores: legacyStores,
        keys: legacy,
        key,
        defaults: undefined,
        migrate: config.migrate,
      })
      return migrated
    },
    setItem: (key, value) => {
      currentStorage.setItem(key, value)
    },
    removeItem: (key) => {
      currentStorage.removeItem(key)
    },
  })
}

/**
 * Wrap a Zustand `createStore` invocation with the OpenCode persistence
 * semantics. The store behaves like a normal Zustand store but writes are
 * mirrored to `localStorage` (or the platform-provided async storage when
 * `isDesktop` is true upstream).
 */
export function persisted<T extends object>(
  target: string | PersistTarget,
  initializer: (set: StoreApi<T>["setState"], get: StoreApi<T>["getState"]) => T,
  options?: { name?: string; onRehydrate?: (state: T) => void },
): UseBoundStore<StoreApi<T>> {
  const config: PersistTarget = typeof target === "string" ? { key: target } : target
  const created = createStore<T>()(
    persist(initializer as any, {
      name: options?.name ?? config.key,
      storage: createJSONStorage(() => buildStorage(config)() ?? undefinedStorage()),
      migrate: (value: any) => (config.migrate ? config.migrate(value) : value),
      onRehydrateStorage: () => (state: any) => {
        if (state && options?.onRehydrate) options.onRehydrate(state)
      },
    }),
  )
  // Zustand v5's `persist` returns a `WithPersist<StoreApi<T>, T>` which
  // is a superset of `UseBoundStore<StoreApi<T>>` (it adds `persist.*`
  // helpers). Consumers don't need those — cast for a clean public type.
  return created as unknown as UseBoundStore<StoreApi<T>>
}

export function removePersisted(target: { storage?: string; legacyStorageNames?: string[]; key: string }) {
  if (!target.storage) {
    localStorageDirect().removeItem(target.key)
    return
  }
  localStorageWithPrefix(target.storage).removeItem(target.key)
  for (const storage of target.legacyStorageNames ?? []) {
    localStorageWithPrefix(storage).removeItem(target.key)
  }
}

export const Persist = {
  global(key: string, legacy?: string[]): PersistTarget {
    return { storage: GLOBAL_STORAGE, key, legacy }
  },
  workspace(dir: string, key: string, legacy?: string[]): PersistTarget {
    const head = (dir.slice(0, 12) || "workspace").replace(/[^a-zA-Z0-9._-]/g, "-")
    const sum = checksum(dir)
    return { storage: `opencode.workspace.${head}.${sum}.dat`, key: `workspace:${key}`, legacy }
  },
  session(dir: string, session: string, key: string, legacy?: string[]): PersistTarget {
    const head = (dir.slice(0, 12) || "workspace").replace(/[^a-zA-Z0-9._-]/g, "-")
    const sum = checksum(dir)
    return {
      storage: `opencode.workspace.${head}.${sum}.dat`,
      key: `session:${session}:${key}`,
      legacy,
    }
  },
}

function checksum(input: string): string {
  // Lightweight non-crypto hash so the port doesn't depend on the OpenCode
  // core util module. The output is stable across reloads for a given input
  // and produces a short hex string usable as a storage namespace.
  let h1 = 0xdeadbeef ^ 0
  let h2 = 0x41c6ce57 ^ 0
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16)
}

// Re-export for parity with the original `makePersisted` shape.
export { snapshot }
