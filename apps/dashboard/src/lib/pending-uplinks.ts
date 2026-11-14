// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Durable uplink ledger (ZCode `packages/ui/src/v4/pendingCommandRegistry`
 * borrowing): before any decision-bearing uplink leaves the client, a
 * reconciliation clue is persisted to localStorage — otherwise a renderer
 * reload, a lost response or a dropped connection leaves the UI cleared
 * while nobody can prove whether the server admitted the uplink.
 *
 * Discipline carried over from the reference registry:
 *   - The clue is written BEFORE the uplink; when persistence fails the
 *     caller must refuse the uplink (`register` returns false) — an
 *     untracked send could never be reconciled.
 *   - `accepted` / `duplicate` acknowledgements close the entry out; a
 *     client-side `failed` only marks it (a transport failure is not proof
 *     of non-delivery — the response can be lost after the server already
 *     processed the request) and leaves it re-armed for reconciliation.
 *   - After a reconnect, `reconcile` asks the server for the truth of every
 *     pending clue. An authoritative verdict closes the entry; `unknown`
 *     keeps it — an unanswered query is not a refusal, and clearing here
 *     would both recover already-delivered content and drop the settlement
 *     of a late ACK.
 *   - The 24 h TTL is anchored at FIRST registration; retries and
 *     reconciles never extend it, so a clue that can never be settled
 *     still ages out instead of leaking forever.
 *   - Sensitive uplinks never store plaintext payloads — only an FNV-1a
 *     digest, enough to correlate a clue without leaking content.
 *
 * The registry itself never produces authoritative facts and never
 * auto-replays an uplink; replay is always a user action.
 *
 * `storage` / `now` are injectable so tests can drive persistence and TTL
 * deterministically (the `pendingUplinks` singleton below uses the real
 * browser storage and clock).
 */

export type PendingUplinkKind = "chat" | "permission" | "approval"

/** ACK outcomes reported by the caller that performed the uplink. */
export type PendingUplinkOutcome = "accepted" | "duplicate" | "failed"

/** Verdicts a reconnect lookup may return about one uplink. */
export type PendingUplinkVerdict = "accepted" | "duplicate" | "failed" | "unknown"

export const PENDING_UPLINK_TTL_MS = 24 * 60 * 60 * 1_000
export const PENDING_UPLINKS_STORAGE_KEY = "maximilian.pending-uplinks:v1"

interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

interface PendingUplinkEntry {
  id: string
  kind: PendingUplinkKind
  /** Reconcileable payload — omitted entirely for sensitive uplinks. */
  payload?: unknown
  /**
   * FNV-1a digest of the payload for sensitive uplinks: correlates the
   * clue without persisting any plaintext.
   */
  payloadDigest?: string
  sensitive: boolean
  /**
   * "pending" while awaiting an authoritative word; "failed" marks a
   * client-side failure whose truth the server still owes us (kept for
   * reconciliation, never silently dropped).
   */
  status: "pending" | "failed"
  issuedAt: number
  /** TTL anchored at first registration — reload/reconcile never extends it. */
  expiresAt: number
}

export interface PendingUplinksOptions {
  /**
   * Storage backing the ledger. `null` disables persistence explicitly
   * (register will refuse uplinks); leaving it undefined picks the
   * browser's localStorage when available.
   */
  storage?: StorageLike | null
  now?: () => number
}

export interface PendingUplinksApi {
  register(
    id: string,
    opts: { kind: PendingUplinkKind; payload?: unknown; sensitive?: boolean },
  ): boolean
  settle(id: string, outcome: PendingUplinkOutcome): void
  reconcile(lookup: (id: string, kind: string) => Promise<PendingUplinkVerdict>): Promise<void>
}

/**
 * FNV-1a 32-bit, hex-encoded — the digest format ZCode's registry uses for
 * sensitive command payloads. Deterministic and collision-unfriendly
 * enough for ledger correlation; never used as a security primitive.
 */
export function fnv1aHex(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, "0")
}

function browserStorage(): StorageLike | undefined {
  try {
    return typeof localStorage !== "undefined" ? localStorage : undefined
  } catch {
    return undefined
  }
}

/** Defensive entry validation — anything malformed is dropped on load. */
function isEntry(value: unknown): value is PendingUplinkEntry {
  if (!value || typeof value !== "object") return false
  const entry = value as Partial<PendingUplinkEntry>
  return (
    typeof entry.id === "string" &&
    entry.id !== "" &&
    (entry.kind === "chat" || entry.kind === "permission" || entry.kind === "approval") &&
    (entry.status === "pending" || entry.status === "failed") &&
    typeof entry.issuedAt === "number" &&
    typeof entry.expiresAt === "number" &&
    typeof entry.sensitive === "boolean"
  )
}

export function createPendingUplinks(options: PendingUplinksOptions = {}): PendingUplinksApi {
  const storage = options.storage === null ? undefined : (options.storage ?? browserStorage())
  const now = options.now ?? (() => Date.now())
  const entries = new Map<string, PendingUplinkEntry>()
  /** Deduplicates concurrent reconciles into one pass (ZCode reconcileSession). */
  let reconcileInFlight: Promise<void> | undefined

  function load(): void {
    if (!storage) return
    try {
      const raw = storage.getItem(PENDING_UPLINKS_STORAGE_KEY)
      if (!raw) return
      const parsed: unknown = JSON.parse(raw)
      if (!Array.isArray(parsed)) return
      for (const value of parsed) {
        if (isEntry(value)) entries.set(value.id, value)
      }
      pruneExpired()
    } catch {
      // Corrupted storage must not block chat: these are client-side
      // reconciliation clues, not authoritative facts (reference registry
      // drops the payload on parse failure for the same reason).
      entries.clear()
    }
  }

  function pruneExpired(): boolean {
    const at = now()
    let changed = false
    for (const [id, entry] of entries) {
      if (entry.expiresAt <= at) {
        entries.delete(id)
        changed = true
      }
    }
    return changed
  }

  /** Persist the ledger; false means the write failed (caller must refuse the uplink). */
  function commit(): boolean {
    if (!storage) return false
    try {
      if (entries.size === 0) storage.removeItem(PENDING_UPLINKS_STORAGE_KEY)
      else storage.setItem(PENDING_UPLINKS_STORAGE_KEY, JSON.stringify([...entries.values()]))
      return true
    } catch {
      // Quota exceeded / storage disabled — signal refusal to the caller.
      return false
    }
  }

  load()

  return {
    register(id, opts) {
      // Prune BEFORE the idempotence check: a clue that already expired
      // must not block a fresh registration of the same id, while a live
      // clue keeps its anchored TTL below.
      pruneExpired()
      if (entries.has(id)) {
        // Idempotent re-registration (e.g. a retry of the same uplink):
        // the clue already exists and its TTL stays anchored at first
        // registration — retries must never extend the ledger window.
        return true
      }
      const issuedAt = now()
      const entry: PendingUplinkEntry = {
        id,
        kind: opts.kind,
        sensitive: opts.sensitive ?? false,
        status: "pending",
        issuedAt,
        expiresAt: issuedAt + PENDING_UPLINK_TTL_MS,
      }
      if (opts.sensitive) {
        // Sensitive uplinks store only a digest — never the plaintext.
        entry.payloadDigest = fnv1aHex(JSON.stringify(opts.payload ?? null))
      } else if (opts.payload !== undefined) {
        entry.payload = opts.payload
      }
      entries.set(id, entry)
      // 首发恢复线索必须先持久化；失败时拒绝上行 (reference registry
      // discipline): an uplink without a persisted clue could never be
      // reconciled after a reload, so the caller must refuse to send it.
      if (!commit()) {
        entries.delete(id)
        return false
      }
      return true
    },

    settle(id, outcome) {
      const entry = entries.get(id)
      if (!entry) return
      if (outcome === "accepted" || outcome === "duplicate") {
        // ACK 收口: the server confirmed receipt (or an identical prior
        // delivery of the same uplink) — the clue has served its purpose.
        entries.delete(id)
        commit()
        return
      }
      // "failed" 退回: a client-side failure is not proof of
      // non-delivery, so the entry stays (marked) and remains eligible
      // for reconciliation; only an authoritative verdict or the TTL
      // closes it.
      if (entry.status === "failed") return
      entries.set(id, { ...entry, status: "failed" })
      commit()
    },

    reconcile(lookup) {
      if (reconcileInFlight) return reconcileInFlight
      pruneExpired()
      // Iterate a snapshot: lookups are async and entries may settle while
      // one is in flight (re-validated per entry below).
      const snapshot = [...entries.values()]
      if (snapshot.length === 0) return Promise.resolve()
      reconcileInFlight = (async () => {
        let changed = false
        for (const entry of snapshot) {
          if (!entries.has(entry.id)) continue // settled while we waited
          let verdict: PendingUplinkVerdict
          try {
            verdict = await lookup(entry.id, entry.kind)
          } catch {
            // A lookup that throws answered nothing — same as "unknown".
            verdict = "unknown"
          }
          if (!entries.has(entry.id)) continue // settled during the lookup
          if (verdict === "unknown") {
            // 不清账 (reference applyQuery discipline): an unmatched or
            // unavailable query is not a refusal. Early clearing would
            // recover already-sent content and drop a late ACK's
            // settlement. The clue stays until an authoritative result,
            // an explicit settle, or the TTL.
            continue
          }
          // Authoritative verdict (accepted / duplicate / failed): 收口.
          entries.delete(entry.id)
          changed = true
        }
        if (changed) commit()
      })().finally(() => {
        reconcileInFlight = undefined
      })
      return reconcileInFlight
    },
  }
}

/**
 * The app-wide ledger singleton. The exposed surface is a pinned
 * cross-agent contract (consumed by PermissionDialog integrations):
 * register before the uplink, settle on the ACK, reconcile on reconnect.
 */
export const pendingUplinks: PendingUplinksApi = createPendingUplinks()
