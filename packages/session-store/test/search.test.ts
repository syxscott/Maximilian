import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { SessionStore } from "../src/index.js"

let store: SessionStore

beforeEach(() => {
  store = new SessionStore({ path: ":memory:" })
})

afterEach(() => {
  store.close()
})

function seed(): void {
  store.appendSession({ id: "s1", workspaceId: "ws-1", title: "login bug" })
  store.appendSession({ id: "s2", workspaceId: "ws-2", title: "other" })
  store.appendMessage({
    id: "m1",
    sessionId: "s1",
    role: "user",
    content: "Please FIX the Login bug",
    createdAt: "2026-01-01T00:00:00.000Z",
  })
  store.appendMessage({
    id: "m2",
    sessionId: "s2",
    role: "assistant",
    content: "Fixed the login bug in auth.ts",
    createdAt: "2026-01-02T00:00:00.000Z",
  })
}

describe("SessionStore.searchMessages", () => {
  it("finds hits case-insensitively and carries workspace context from the join", () => {
    seed()
    const hits = store.searchMessages("login")
    expect(hits).toHaveLength(2)
    expect(hits.map((h) => h.sessionId).sort()).toEqual(["s1", "s2"])
    const s1 = hits.find((h) => h.sessionId === "s1")
    expect(s1).toMatchObject({
      sessionId: "s1",
      workspaceId: "ws-1",
      role: "user",
      content: "Please FIX the Login bug",
      createdAt: "2026-01-01T00:00:00.000Z",
    })
  })

  it("returns nothing for a miss", () => {
    seed()
    expect(store.searchMessages("kubernetes")).toEqual([])
  })

  it("treats % and _ as literals (wildcard escaping)", () => {
    store.appendSession({ id: "s1", workspaceId: "ws-1" })
    store.appendMessage({ id: "m1", sessionId: "s1", role: "user", content: "progress 100%" })
    store.appendMessage({ id: "m2", sessionId: "s1", role: "user", content: "a_b literal" })
    store.appendMessage({ id: "m3", sessionId: "s1", role: "user", content: "aXb wildcard decoy" })

    // Without escaping, "%" alone would match EVERY row; "_" would match
    // any single character ("aXb" for query "a_b"). With escaping they
    // only find the literal characters.
    expect(store.searchMessages("%")).toHaveLength(1)
    expect(store.searchMessages("%")[0]?.content).toBe("progress 100%")
    expect(store.searchMessages("100%")).toHaveLength(1)
    expect(store.searchMessages("a_b")).toHaveLength(1)
    expect(store.searchMessages("a_b")[0]?.content).toBe("a_b literal")
    // Normal characters keep SQLite's case-insensitive LIKE behavior.
    expect(store.searchMessages("AXb")[0]?.content).toBe("aXb wildcard decoy")
    // Backslash is escaped too — a literal backslash query cannot break out
    // of the ESCAPE clause.
    expect(store.searchMessages("\\")).toEqual([])
  })

  it("honors the limit (default 50) and returns newest first", () => {
    store.appendSession({ id: "s1", workspaceId: "ws-1" })
    for (let i = 0; i < 60; i++) {
      store.appendMessage({
        id: `m${i}`,
        sessionId: "s1",
        role: "user",
        content: "needle",
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
      })
    }
    expect(store.searchMessages("needle")).toHaveLength(50)
    expect(store.searchMessages("needle")[0]?.createdAt).toBe("2026-01-01T00:59:00.000Z")
    expect(store.searchMessages("needle", { limit: 3 })).toHaveLength(3)
  })

  it("filters by workspaceId", () => {
    seed()
    const ws1 = store.searchMessages("login", { workspaceId: "ws-1" })
    expect(ws1).toHaveLength(1)
    expect(ws1[0]?.sessionId).toBe("s1")
    expect(store.searchMessages("login", { workspaceId: "ws-nope" })).toEqual([])
  })

  it("excludes soft-deleted (rewound) messages", () => {
    store.appendSession({ id: "s1", workspaceId: "ws-1" })
    store.appendMessage({
      id: "m1",
      sessionId: "s1",
      role: "user",
      content: "secret plan",
      turnOrdinal: 1,
    })
    expect(store.searchMessages("secret")).toHaveLength(1)
    store.rewindFromTurn("s1", 1)
    expect(store.searchMessages("secret")).toEqual([])
  })
})
