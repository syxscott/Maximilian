// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Tests for the history backup/restore protocol (deepseek chat-demo
 * history/ borrowing): roundtrip fidelity, the version gate, corrupt
 * input rejection (with the original data intact), tree invariants, and
 * the serial queue.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { unzipSync, zipSync } from "fflate"
import {
  SessionStore,
  BackupError,
  clearSessionsBackup,
  exportSessionsBackup,
  importSessionsBackup,
  getVisibleMessages,
  normalizeMessageTree,
  treeBoundaryMetaKey,
  treeRootMetaKey,
  type ArchiveMessage,
  type MessageTreeRow,
  type SessionBackupFile,
} from "../src/index.js"

let dir: string
let dbPath: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "session-backup-"))
  dbPath = path.join(dir, "sessions.db")
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

/** Row projection WITHOUT the hash-chain columns (restore re-legacizes them by design). */
function contentRows(store: SessionStore, sessionId: string) {
  return store.listMessages(sessionId).map((row) => ({
    id: row.id,
    sessionId: row.sessionId,
    role: row.role,
    content: row.content,
    createdAt: row.createdAt,
    turnOrdinal: row.turnOrdinal,
    deletedAt: row.deletedAt,
    parentId: row.parentId,
    selectedChildId: row.selectedChildId,
  }))
}

function visible(store: SessionStore, sessionId: string): string[] {
  const rows: MessageTreeRow[] = store.listMessages(sessionId).map((row) => ({
    id: row.id,
    parentId: row.parentId,
    selectedChildId: row.selectedChildId,
    createdAt: row.createdAt,
    deleted: row.deletedAt !== null,
  }))
  return getVisibleMessages(
    normalizeMessageTree(rows, {
      rootId: store.getMeta(treeRootMetaKey(sessionId)) ?? undefined,
      boundaryId: store.getMeta(treeBoundaryMetaKey(sessionId)) ?? undefined,
    }),
  ).map((m) => m.id)
}

/** A store shaped like real runtime data: linear legacy, forked tree, assistant-only. */
function buildLiveStore(): SessionStore {
  const store = new SessionStore({ path: dbPath }).migrate()
  // Linear legacy session, with a rewound (soft-deleted) tail.
  store.appendSession({ id: "s-linear", workspaceId: "ws-1", title: "linear" })
  store.appendMessage({
    id: "l1",
    sessionId: "s-linear",
    role: "user",
    content: "q1",
    turnOrdinal: 0,
    createdAt: "2026-01-01T00:00:01.000Z",
  })
  store.appendMessage({
    id: "l2",
    sessionId: "s-linear",
    role: "assistant",
    content: "a1",
    turnOrdinal: 0,
    createdAt: "2026-01-01T00:00:02.000Z",
  })
  store.appendMessage({
    id: "l3",
    sessionId: "s-linear",
    role: "user",
    content: "q2",
    turnOrdinal: 1,
    createdAt: "2026-01-01T00:00:03.000Z",
  })
  store.rewindFromTurn("s-linear", 1)

  // Forked tree session (user-rooted, alternating).
  store.appendSession({ id: "s-tree", workspaceId: "ws-1", title: "tree" })
  store.appendMessage({
    id: "t1",
    sessionId: "s-tree",
    role: "user",
    content: "q",
    turnOrdinal: 0,
    createdAt: "2026-01-01T00:01:00.000Z",
  })
  store.appendMessage({
    id: "t2",
    sessionId: "s-tree",
    role: "assistant",
    content: "a",
    turnOrdinal: 0,
    createdAt: "2026-01-01T00:01:01.000Z",
  })
  const [q1] = store.appendBranch("s-tree", "t2", [
    { role: "user", content: "q-prime", turnOrdinal: 1 },
    { role: "assistant", content: "a-prime", turnOrdinal: 1 },
  ])
  const [q2] = store.appendBranch("s-tree", "t2", [
    { role: "user", content: "q-second", turnOrdinal: 1 },
    { role: "assistant", content: "a-second", turnOrdinal: 1 },
  ])
  const [x] = store.appendBranch("s-tree", q2.id, [{ role: "assistant", content: "a-second-cont" }])
  // The root marker stays at the linear-era head; the selection below it
  // lives in the branch rows' selected_child_id pointers.
  expect(store.getMeta(treeRootMetaKey("s-tree"))).toBe("t1")
  expect(store.getMeta(treeBoundaryMetaKey("s-tree"))).toBe("t2")
  expect(visible(store, "s-tree")).toEqual(["t1", "t2", q2.id, x.id])

  // Assistant-only linear session (runtime task-complete shape).
  store.appendSession({ id: "s-task", workspaceId: "ws-2", title: "task" })
  store.appendMessage({
    id: "k1",
    sessionId: "s-task",
    role: "assistant",
    content: "task output",
    turnOrdinal: 0,
    createdAt: "2026-01-01T00:02:00.000Z",
  })

  // Runtime operation data that must survive restore untouched.
  store.appendEvent({ workspaceId: "ws-1", type: "task-complete", payload: { id: "t-42" } })
  store.recordUsage({ workspaceId: "ws-1", role: "assistant", tokensIn: 10, tokensOut: 5 })
  store.enqueueSteering({ workspaceId: "ws-1", text: "slow down", receiptId: "r-1" })
  store.upsertLessonEfficacy("planner", "sql", 1, 0.5)
  return store
}

describe("backup export", () => {
  it("writes manifest.json first and a dated filename, and declares exclusions", async () => {
    const store = buildLiveStore()
    const { bytes, filename, manifest } = await exportSessionsBackup(store)

    expect(filename).toMatch(/^maximilian-sessions-\d{4}-\d{2}-\d{2}\.zip$/)
    expect(manifest.export_format_version).toBe(1)
    expect(manifest.excluded).toEqual([
      "events",
      "usage",
      "steering_queue",
      "lesson_efficacy",
      "audit",
    ])

    const entries = unzipSync(bytes)
    const names = Object.keys(entries)
    expect(names[0]).toBe("manifest.json")
    expect(names[names.length - 1]).toBe("session_index.json")
    expect(names.filter((n) => n.startsWith("sessions/"))).toHaveLength(3)

    const manifestJson = JSON.parse(new TextDecoder().decode(entries["manifest.json"])) as {
      counts: { sessions: number; messages: number }
    }
    expect(manifestJson.counts.sessions).toBe(3)
    expect(manifestJson.counts.messages).toBe(11)
    store.close()
  })
})

describe("backup roundtrip — export → clear → import → content identical", () => {
  it("restores sessions, message trees, soft-deletes and tree markers losslessly", async () => {
    const store = buildLiveStore()
    const before = {
      sessions: store.listSessions().map((s) => ({ ...s })),
      linear: contentRows(store, "s-linear"),
      tree: contentRows(store, "s-tree"),
      task: contentRows(store, "s-task"),
      visibleLinear: visible(store, "s-linear"),
      visibleTree: visible(store, "s-tree"),
      treeRoot: store.getMeta(treeRootMetaKey("s-tree")),
      treeBoundary: store.getMeta(treeBoundaryMetaKey("s-tree")),
    }

    const { bytes } = await exportSessionsBackup(store)
    await clearSessionsBackup(store)
    expect(store.listSessions()).toEqual([])
    expect(store.listMessages("s-tree")).toEqual([])
    expect(store.getMeta(treeRootMetaKey("s-tree"))).toBeNull()
    // Runtime operation data is deliberately NOT cleared with the sessions.
    expect(store.listEvents("ws-1")).toHaveLength(1)

    const restored = await importSessionsBackup(store, bytes)
    expect(restored).toBe(3)

    expect(store.listSessions().map((s) => ({ ...s }))).toEqual(before.sessions)
    expect(contentRows(store, "s-linear")).toEqual(before.linear)
    expect(contentRows(store, "s-tree")).toEqual(before.tree)
    expect(contentRows(store, "s-task")).toEqual(before.task)
    expect(visible(store, "s-linear")).toEqual(before.visibleLinear)
    expect(visible(store, "s-tree")).toEqual(before.visibleTree)
    expect(store.getMeta(treeRootMetaKey("s-tree"))).toBe(before.treeRoot)
    expect(store.getMeta(treeBoundaryMetaKey("s-tree"))).toBe(before.treeBoundary)
    // Rewound rows stay rewound.
    expect(store.listMessages("s-linear").find((row) => row.id === "l3")?.deletedAt).not.toBeNull()
    expect(store.listEvents("ws-1")).toHaveLength(1)
    expect(store.pendingSteering("ws-1")).toHaveLength(1)
    expect(store.getLessonEfficacy("planner")).toHaveLength(1)
    store.close()
  })

  it("re-legacizes restored rows (chain columns NULL) and chains new appends from genesis", async () => {
    const store = buildLiveStore()
    const { bytes } = await exportSessionsBackup(store)
    await importSessionsBackup(store, bytes)

    for (const sessionId of ["s-linear", "s-tree", "s-task"]) {
      for (const row of store.listMessages(sessionId)) {
        expect(row.seq).toBeNull()
        expect(row.prevHash).toBeNull()
        expect(row.hash).toBeNull()
      }
      // Every restored session is a legacy segment: verification skips it.
      expect(store.verifyHistory(sessionId)).toEqual({ ok: true })
    }

    // New appends after restore start a fresh chain at GENESIS.
    store.appendMessage({
      id: "post-restore",
      sessionId: "s-linear",
      role: "assistant",
      content: "new tail",
      createdAt: "2026-02-01T00:00:00.000Z",
    })
    expect(store.verifyHistory("s-linear")).toEqual({ ok: true })
    const tail = store.listMessages("s-linear").at(-1)
    expect(tail?.prevHash).not.toBeNull()
    store.close()
  })

  it("keeps restored tree sessions switchable and linear sessions linear", async () => {
    const store = buildLiveStore()
    const { bytes } = await exportSessionsBackup(store)
    await importSessionsBackup(store, bytes)

    // Linear legacy session: no tree, nothing to switch.
    expect(store.selectMessageVersion("s-linear", "l1")).toBe(false)

    // Tree session: the sibling of the selected branch is switchable, and
    // the visible path follows the switch — including the restored
    // branch's own parked subtree choice — exactly as before the backup.
    const treeMessages = store.listMessages("s-tree")
    const q1 = treeMessages.find((row) => row.content === "q-prime")
    const r1 = treeMessages.find((row) => row.content === "a-prime")
    expect(q1).toBeDefined()
    expect(r1).toBeDefined()
    expect(store.selectMessageVersion("s-tree", q1.id)).toBe(true)
    expect(visible(store, "s-tree")).toEqual(["t1", "t2", q1.id, r1.id])
    store.close()
  })

  it("serializes concurrent imports through the backup queue", async () => {
    const store = buildLiveStore()
    const oneSession = await exportSessionsBackup(store)

    const other = new SessionStore({ path: path.join(dir, "other.db") }).migrate()
    other.appendSession({ id: "only", workspaceId: "ws-x" })
    other.appendMessage({ id: "o1", sessionId: "only", role: "user", content: "hi" })
    const twoSessions = await exportSessionsBackup(other)
    other.close()

    // Fired together; the queue applies them one at a time in call order.
    const [a, b] = await Promise.all([
      importSessionsBackup(store, oneSession.bytes),
      importSessionsBackup(store, twoSessions.bytes),
    ])
    expect(a).toBe(3)
    expect(b).toBe(1)
    expect(store.listSessions().map((s) => s.id)).toEqual(["only"])
    store.close()
  })
})

describe("backup import validation — rejects without touching the store", () => {
  function snapshot(store: SessionStore) {
    return {
      sessions: store.listSessions().map((s) => ({ ...s })),
      messages: store.listSessions().flatMap((s) => contentRows(store, s.id)),
      events: store.listEvents("ws-1").map((e) => e.id),
    }
  }

  function expectUnchanged(store: SessionStore, before: ReturnType<typeof snapshot>): void {
    expect(store.listSessions().map((s) => ({ ...s }))).toEqual(before.sessions)
    expect(store.listSessions().flatMap((s) => contentRows(store, s.id))).toEqual(before.messages)
    expect(store.listEvents("ws-1").map((e) => e.id)).toEqual(before.events)
  }

  const message = (
    over: Partial<ArchiveMessage> & { id: string; role: string },
  ): ArchiveMessage => ({
    sessionId: "s",
    content: `content-${over.id}`,
    createdAt: "2026-01-01T00:00:00.000Z",
    turnOrdinal: 0,
    deletedAt: null,
    parentId: null,
    selectedChildId: null,
    ...over,
  })

  const sessionFile = (
    over: Partial<SessionBackupFile> & { id: string; messages: ArchiveMessage[] },
  ): SessionBackupFile => ({
    workspaceId: "ws",
    title: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    treeRootId: null,
    treeBoundaryId: null,
    ...over,
  })

  /** Assemble an archive; entries serialize in insertion order (manifest must come first). */
  function zipEntries(entries: Record<string, unknown>): Uint8Array {
    const encoded: Record<string, Uint8Array> = {}
    for (const [name, value] of Object.entries(entries)) {
      encoded[name] = new TextEncoder().encode(JSON.stringify(value))
    }
    return zipSync(encoded, { level: 0 })
  }

  function archiveWith(
    sessions: SessionBackupFile[],
    manifestOver?: Record<string, unknown>,
  ): Uint8Array {
    const entries: Record<string, unknown> = {
      "manifest.json": {
        export_format_version: 1,
        exported_at: "2026-11-14T00:00:00.000Z",
        counts: {
          sessions: sessions.length,
          messages: sessions.reduce((sum, s) => sum + s.messages.length, 0),
        },
        excluded: ["events", "usage", "steering_queue", "lesson_efficacy", "audit"],
      },
    }
    for (const file of sessions) entries[`sessions/${file.id}.json`] = file
    entries["session_index.json"] = sessions.map((s) => ({
      id: s.id,
      title: s.title,
      workspaceId: s.workspaceId,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      messageCount: s.messages.length,
    }))
    return zipEntries({ ...entries, ...manifestOver })
  }

  const linearSession = () =>
    sessionFile({
      id: "s",
      messages: [
        message({ id: "m1", role: "user" }),
        message({ id: "m2", role: "assistant", parentId: null }),
      ],
    })

  beforeEach(async () => {
    const store = buildLiveStore()
    store.close()
  })

  it("rejects corrupt bytes with the original data intact", async () => {
    const store = new SessionStore({ path: dbPath }).migrate()
    const before = snapshot(store)
    const garbage = new TextEncoder().encode("this is definitely not a zip file")
    await expect(importSessionsBackup(store, garbage)).rejects.toThrow(BackupError)
    await expect(importSessionsBackup(store, garbage)).rejects.toThrow(/unreadable zip/)
    expectUnchanged(store, before)
    store.close()
  })

  it("rejects a future format version (and any non-1 version)", async () => {
    const store = new SessionStore({ path: dbPath }).migrate()
    const before = snapshot(store)

    await expect(
      importSessionsBackup(
        store,
        archiveWith([linearSession()], {
          "manifest.json": {
            export_format_version: 2,
            exported_at: "2026-11-14T00:00:00.000Z",
            counts: { sessions: 1, messages: 2 },
            excluded: [],
          },
        }),
      ),
    ).rejects.toThrow(/newer than the supported/)

    await expect(
      importSessionsBackup(
        store,
        archiveWith([linearSession()], {
          "manifest.json": {
            export_format_version: 0,
            exported_at: "2026-11-14T00:00:00.000Z",
            counts: { sessions: 1, messages: 2 },
            excluded: [],
          },
        }),
      ),
    ).rejects.toThrow(/unsupported export_format_version/)

    expectUnchanged(store, before)
    store.close()
  })

  it("rejects a missing or mispositioned manifest and a missing index", async () => {
    const store = new SessionStore({ path: dbPath }).migrate()
    const before = snapshot(store)

    const missingManifest = zipEntries({
      "sessions/s.json": linearSession(),
      "session_index.json": [],
    })
    await expect(importSessionsBackup(store, missingManifest)).rejects.toThrow(
      /manifest\.json missing/,
    )

    const mispositioned = zipEntries({
      "sessions/s.json": linearSession(),
      "manifest.json": {
        export_format_version: 1,
        exported_at: "2026-11-14T00:00:00.000Z",
        counts: { sessions: 1, messages: 2 },
        excluded: [],
      },
      "session_index.json": [],
    })
    await expect(importSessionsBackup(store, mispositioned)).rejects.toThrow(
      /must be the first archive entry/,
    )

    const missingIndex = zipEntries({
      "manifest.json": {
        export_format_version: 1,
        exported_at: "2026-11-14T00:00:00.000Z",
        counts: { sessions: 1, messages: 2 },
        excluded: [],
      },
      "sessions/s.json": linearSession(),
    })
    await expect(importSessionsBackup(store, missingIndex)).rejects.toThrow(
      /session_index\.json missing/,
    )

    expectUnchanged(store, before)
    store.close()
  })

  it("rejects dangling parents, cycles, and selected-child mismatches", async () => {
    const store = new SessionStore({ path: dbPath }).migrate()
    const before = snapshot(store)

    // Parent does not exist in the session.
    await expect(
      importSessionsBackup(
        store,
        archiveWith([
          sessionFile({
            id: "s",
            messages: [message({ id: "m1", role: "user", parentId: "ghost" })],
          }),
        ]),
      ),
    ).rejects.toThrow(/references missing parent/)

    // Two-message cycle (roles alternate, so only the walk catches it —
    // the arbitrary-string-id replacement of chat-demo's id ordering rule).
    await expect(
      importSessionsBackup(
        store,
        archiveWith([
          sessionFile({
            id: "s",
            messages: [
              message({ id: "m1", role: "user", parentId: "m2" }),
              message({ id: "m2", role: "assistant", parentId: "m1" }),
            ],
          }),
        ]),
      ),
    ).rejects.toThrow(/parent cycle/)

    // selected_child_id points at a row that does not agree about its parent.
    await expect(
      importSessionsBackup(
        store,
        archiveWith([
          sessionFile({
            id: "s",
            treeRootId: "m1",
            messages: [
              message({ id: "m1", role: "user", selectedChildId: "m3" }),
              message({ id: "m2", role: "assistant", parentId: "m1" }),
              message({ id: "m3", role: "assistant", parentId: "m2" }),
            ],
          }),
        ]),
      ),
    ).rejects.toThrow(/whose declared parent/)

    expectUnchanged(store, before)
    store.close()
  })

  it("enforces the role protocol for tree sessions (alternation, question roots)", async () => {
    const store = new SessionStore({ path: dbPath }).migrate()
    const before = snapshot(store)

    // Adjacent same-role rows on an explicit edge.
    await expect(
      importSessionsBackup(
        store,
        archiveWith([
          sessionFile({
            id: "s",
            treeRootId: "m1",
            messages: [
              message({ id: "m1", role: "user" }),
              message({ id: "m2", role: "user", parentId: "m1" }),
            ],
          }),
        ]),
      ),
    ).rejects.toThrow(/roles must alternate/)

    // A root branch head that is not a question.
    await expect(
      importSessionsBackup(
        store,
        archiveWith([
          sessionFile({
            id: "s",
            treeRootId: "m1",
            messages: [
              message({ id: "m1", role: "assistant" }),
              message({ id: "m2", role: "user", parentId: "m1" }),
            ],
          }),
        ]),
      ),
    ).rejects.toThrow(/must be a user message/)

    expectUnchanged(store, before)
    store.close()
  })

  it("rejects index/session drift, duplicate ids and tree state without a root", async () => {
    const store = new SessionStore({ path: dbPath }).migrate()
    const before = snapshot(store)

    // messageCount disagrees with the session file.
    const drifting = zipEntries({
      "manifest.json": {
        export_format_version: 1,
        exported_at: "2026-11-14T00:00:00.000Z",
        counts: { sessions: 1, messages: 2 },
        excluded: [],
      },
      "sessions/s.json": linearSession(),
      "session_index.json": [
        {
          id: "s",
          title: null,
          workspaceId: "ws",
          createdAt: null,
          updatedAt: null,
          messageCount: 5,
        },
      ],
    })
    await expect(importSessionsBackup(store, drifting)).rejects.toThrow(/declares 5 messages/)

    // The same message id archived in two sessions (it is the table's PK).
    const dupId = zipEntries({
      "manifest.json": {
        export_format_version: 1,
        exported_at: "2026-11-14T00:00:00.000Z",
        counts: { sessions: 2, messages: 2 },
        excluded: [],
      },
      "sessions/a.json": sessionFile({
        id: "a",
        messages: [message({ id: "shared", sessionId: "a", role: "user" })],
      }),
      "sessions/b.json": sessionFile({
        id: "b",
        messages: [message({ id: "shared", sessionId: "b", role: "user" })],
      }),
      "session_index.json": [
        {
          id: "a",
          title: null,
          workspaceId: "ws",
          createdAt: null,
          updatedAt: null,
          messageCount: 1,
        },
        {
          id: "b",
          title: null,
          workspaceId: "ws",
          createdAt: null,
          updatedAt: null,
          messageCount: 1,
        },
      ],
    })
    await expect(importSessionsBackup(store, dupId)).rejects.toThrow(/more than one session/)

    // Explicit tree links without a tree root (inconsistent writer state).
    await expect(
      importSessionsBackup(
        store,
        archiveWith([
          sessionFile({
            id: "s",
            messages: [
              message({ id: "m1", role: "user" }),
              message({ id: "m2", role: "assistant", parentId: "m1" }),
            ],
          }),
        ]),
      ),
    ).rejects.toThrow(/without a tree root/)

    expectUnchanged(store, before)
    store.close()
  })
})

describe("clearSessionsBackup — clear via the same replace path", () => {
  it("empties sessions/messages and tree markers but keeps runtime ledgers", async () => {
    const store = buildLiveStore()
    await clearSessionsBackup(store)
    expect(store.listSessions()).toEqual([])
    expect(store.listMessages("s-linear")).toEqual([])
    expect(store.listMessages("s-tree")).toEqual([])
    expect(store.getMeta(treeRootMetaKey("s-tree"))).toBeNull()
    expect(store.getMeta(treeBoundaryMetaKey("s-tree"))).toBeNull()
    expect(store.listEvents("ws-1")).toHaveLength(1)
    expect(store.listUsage("ws-1")).toHaveLength(1)
    store.close()
  })
})
