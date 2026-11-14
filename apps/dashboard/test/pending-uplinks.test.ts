// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Durable uplink ledger tests (ZCode pendingCommandRegistry borrowing):
 * storage and clock are injected, so persistence failures, ACK
 * settlement, reconnect reconciliation and the anchored TTL are all
 * verified deterministically. These tests also exercise the pinned
 * cross-agent contract surface (`pendingUplinks.register / settle /
 * reconcile`) through the same factory the singleton uses.
 */
import { describe, it, expect, vi } from "vitest"
import {
  createPendingUplinks,
  PENDING_UPLINKS_STORAGE_KEY,
  PENDING_UPLINK_TTL_MS,
  fnv1aHex,
  type PendingUplinkVerdict,
} from "../src/lib/pending-uplinks"

interface FakeStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
  readonly data: Map<string, string>
}

function makeStorage(): FakeStorage {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value)
    },
    removeItem: (key) => {
      data.delete(key)
    },
  }
}

function readEntries(storage: FakeStorage): unknown[] {
  const raw = storage.data.get(PENDING_UPLINKS_STORAGE_KEY)
  if (!raw) return []
  return JSON.parse(raw) as unknown[]
}

describe("pending uplinks ledger", () => {
  it("persists the reconciliation clue BEFORE the uplink", () => {
    const storage = makeStorage()
    const now = vi.fn(() => 1_000)
    const ledger = createPendingUplinks({ storage, now })
    expect(ledger.register("cmd-1", { kind: "chat", payload: { message: "hello" } })).toBe(true)
    const entries = readEntries(storage) as Array<Record<string, unknown>>
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      id: "cmd-1",
      kind: "chat",
      payload: { message: "hello" },
      status: "pending",
      issuedAt: 1_000,
      expiresAt: 1_000 + PENDING_UPLINK_TTL_MS,
    })
  })

  it("returns false and refuses the uplink when persistence fails", () => {
    const storage = makeStorage()
    vi.spyOn(storage, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded")
    })
    const ledger = createPendingUplinks({ storage, now: () => 0 })
    expect(ledger.register("cmd-1", { kind: "chat", payload: { message: "hello" } })).toBe(false)
    // The in-memory clue is rolled back too — no untracked half-state.
    expect(storage.data.has(PENDING_UPLINKS_STORAGE_KEY)).toBe(false)
  })

  it("returns false when no storage is available at all", () => {
    // storage: null = persistence explicitly disabled (e.g. sandboxed
    // iframe where localStorage throws) — uplinks must be refused.
    const ledger = createPendingUplinks({ storage: null, now: () => 0 })
    expect(ledger.register("cmd-1", { kind: "chat" })).toBe(false)
  })

  it("is idempotent per id and never extends the anchored TTL", () => {
    const storage = makeStorage()
    let clock = 1_000
    const ledger = createPendingUplinks({ storage, now: () => clock })
    ledger.register("cmd-1", { kind: "chat", payload: { message: "v1" } })
    clock += 12 * 60 * 60 * 1_000 // 12h later, a retry of the same uplink
    expect(ledger.register("cmd-1", { kind: "chat", payload: { message: "v1" } })).toBe(true)
    const entries = readEntries(storage) as Array<Record<string, unknown>>
    expect(entries).toHaveLength(1)
    // TTL anchored at FIRST registration; the retry must not renew it.
    expect(entries[0].issuedAt).toBe(1_000)
    expect(entries[0].expiresAt).toBe(1_000 + PENDING_UPLINK_TTL_MS)
  })

  it("closes the entry on accepted / duplicate ACKs", () => {
    const storage = makeStorage()
    const ledger = createPendingUplinks({ storage, now: () => 0 })
    ledger.register("cmd-1", { kind: "chat" })
    ledger.register("cmd-2", { kind: "chat" })
    ledger.settle("cmd-1", "accepted")
    ledger.settle("cmd-2", "duplicate")
    expect(readEntries(storage)).toEqual([])
    expect(storage.data.has(PENDING_UPLINKS_STORAGE_KEY)).toBe(false) // empty ledger clears the key
  })

  it("keeps a failed entry (marked) for reconciliation — not proof of non-delivery", () => {
    const storage = makeStorage()
    const ledger = createPendingUplinks({ storage, now: () => 0 })
    ledger.register("cmd-1", { kind: "chat", payload: { message: "hello" } })
    ledger.settle("cmd-1", "failed")
    const entries = readEntries(storage) as Array<Record<string, unknown>>
    expect(entries).toHaveLength(1)
    expect(entries[0].status).toBe("failed")
    // Repeated failed settles do not churn the storage.
    const before = storage.data.get(PENDING_UPLINKS_STORAGE_KEY)
    ledger.settle("cmd-1", "failed")
    expect(storage.data.get(PENDING_UPLINKS_STORAGE_KEY)).toBe(before)
  })

  it("never stores plaintext for sensitive uplinks (FNV digest only)", () => {
    const storage = makeStorage()
    const ledger = createPendingUplinks({ storage, now: () => 0 })
    const secret = { decision: "allow", target: "/etc/shadow" }
    expect(
      ledger.register("perm-1", { kind: "permission", payload: secret, sensitive: true }),
    ).toBe(true)
    const raw = storage.data.get(PENDING_UPLINKS_STORAGE_KEY) ?? ""
    expect(raw).not.toContain("shadow")
    expect(raw).not.toContain("allow")
    const entries = readEntries(storage) as Array<Record<string, unknown>>
    expect(entries[0].payload).toBeUndefined()
    expect(entries[0].payloadDigest).toBe(fnv1aHex(JSON.stringify(secret)))
  })

  it("reconciles a lost ACK to closure on reconnect", async () => {
    const storage = makeStorage()
    const ledger = createPendingUplinks({ storage, now: () => 0 })
    // The ACK was lost mid-flight: the clue is still pending.
    ledger.register("cmd-1", { kind: "chat", payload: { message: "hello" } })
    const lookups: Array<[string, string]> = []
    await ledger.reconcile(async (id, kind) => {
      lookups.push([id, kind])
      return "accepted"
    })
    expect(lookups).toEqual([["cmd-1", "chat"]])
    expect(readEntries(storage)).toEqual([])
  })

  it("closes on an authoritative duplicate and failed verdict, keeps unknown", async () => {
    const storage = makeStorage()
    const ledger = createPendingUplinks({ storage, now: () => 0 })
    ledger.register("cmd-1", { kind: "chat" })
    ledger.register("cmd-2", { kind: "chat" })
    ledger.register("cmd-3", { kind: "chat" })
    const verdict: Record<string, PendingUplinkVerdict> = {
      "cmd-1": "duplicate",
      "cmd-2": "failed",
      "cmd-3": "unknown",
    }
    await ledger.reconcile((id) => Promise.resolve(verdict[id]))
    const entries = readEntries(storage) as Array<Record<string, unknown>>
    // unknown 不清账: an unanswered query is not a refusal.
    expect(entries.map((e) => e.id)).toEqual(["cmd-3"])
  })

  it("treats a throwing lookup as unknown and keeps the clue", async () => {
    const storage = makeStorage()
    const ledger = createPendingUplinks({ storage, now: () => 0 })
    ledger.register("cmd-1", { kind: "chat" })
    ledger.register("cmd-2", { kind: "chat" })
    await ledger.reconcile(async (id) => {
      if (id === "cmd-1") throw new Error("network down")
      return "accepted"
    })
    const entries = readEntries(storage) as Array<Record<string, unknown>>
    expect(entries.map((e) => e.id)).toEqual(["cmd-1"])
  })

  it("does not double-handle an entry settled while its lookup was in flight", async () => {
    const storage = makeStorage()
    const ledger = createPendingUplinks({ storage, now: () => 0 })
    ledger.register("cmd-1", { kind: "chat" })
    let releaseLookup: (v: PendingUplinkVerdict) => void = () => {}
    const gated = new Promise<PendingUplinkVerdict>((resolve) => {
      releaseLookup = resolve
    })
    const first = ledger.reconcile(() => gated)
    const second = ledger.reconcile(async () => "unknown") // deduped into the first pass
    expect(second).toBe(first)
    // The user retries and the ACK lands while the lookup is pending.
    ledger.settle("cmd-1", "accepted")
    releaseLookup("accepted")
    await first
    expect(readEntries(storage)).toEqual([])
  })

  it("prunes expired clues at the anchored TTL and keeps younger ones", () => {
    const storage = makeStorage()
    let clock = 0
    const ledger = createPendingUplinks({ storage, now: () => clock })
    ledger.register("old", { kind: "chat" })
    clock += PENDING_UPLINK_TTL_MS + 1
    ledger.register("young", { kind: "permission", sensitive: true })
    // register triggers the prune pass: the old clue expires exactly 24h
    // after ITS registration, the younger one survives.
    const entries = readEntries(storage) as Array<Record<string, unknown>>
    expect(entries.map((e) => e.id)).toEqual(["young"])
  })

  it("re-registers an id whose clue already expired with a fresh TTL", () => {
    const storage = makeStorage()
    let clock = 0
    const ledger = createPendingUplinks({ storage, now: () => clock })
    ledger.register("cmd-1", { kind: "chat" })
    clock += PENDING_UPLINK_TTL_MS + 1
    expect(ledger.register("cmd-1", { kind: "chat" })).toBe(true)
    const entries = readEntries(storage) as Array<Record<string, unknown>>
    expect(entries).toHaveLength(1)
    expect(entries[0].issuedAt).toBe(clock)
    expect(entries[0].expiresAt).toBe(clock + PENDING_UPLINK_TTL_MS)
  })

  it("rehydrates clues from storage and drops corrupt payloads", () => {
    const storage = makeStorage()
    storage.data.set(
      PENDING_UPLINKS_STORAGE_KEY,
      JSON.stringify([
        {
          id: "cmd-1",
          kind: "chat",
          sensitive: false,
          status: "pending",
          issuedAt: 5,
          expiresAt: 9,
        },
        { broken: true },
      ]),
    )
    const ledger = createPendingUplinks({ storage, now: () => 1 })
    // cmd-1 is alive (expiresAt 9 > now 1); the malformed row is dropped.
    const verdicts: string[] = []
    void ledger.reconcile(async (id) => {
      verdicts.push(id)
      return "unknown"
    })
    expect(verdicts).toEqual(["cmd-1"])
    // Fully corrupt JSON must not throw — the ledger starts empty.
    const broken = makeStorage()
    broken.data.set(PENDING_UPLINKS_STORAGE_KEY, "{not json")
    expect(() => createPendingUplinks({ storage: broken, now: () => 0 })).not.toThrow()
  })

  it("reconcile with no pending clues is a no-op that skips lookups entirely", async () => {
    const storage = makeStorage()
    const ledger = createPendingUplinks({ storage, now: () => 0 })
    const lookup = vi.fn(async () => "accepted" as PendingUplinkVerdict)
    await ledger.reconcile(lookup)
    expect(lookup).not.toHaveBeenCalled()
  })
})
