/**
 * Phase D — MemoryScope (借鉴 crewAI), ADR (借鉴 wshobson), repo memory (借鉴 codebase-memory-mcp).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { MemoryScope, InMemoryBackend } from "../src/memory-scope.js"
import { createADR, parseAdr, createAdrIndex } from "../src/adr.js"
import { FileRepoMemoryStore } from "../src/repo-memory.js"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

describe("MemoryScope (借鉴 crewAI)", () => {
  let backend: InMemoryBackend
  beforeEach(() => { backend = new InMemoryBackend() })

  it("remembers and recalls at the same scope", async () => {
    const root = new MemoryScope(backend, "/backend")
    await root.remember("api design pattern")
    const records = await root.recall()
    expect(records).toHaveLength(1)
    expect(records[0]!.content).toBe("api design pattern")
    expect(records[0]!.scope).toBe("/backend")
  })

  it("isolates records across sibling scopes", async () => {
    const root = new MemoryScope(backend, "/")
    const backend_ = root.subscope("backend")
    const frontend = root.subscope("frontend")
    await backend_.remember("REST endpoints")
    await frontend.remember("React components")
    expect(await backend_.recall()).toHaveLength(1)
    expect(await frontend.recall()).toHaveLength(1)
    expect((await backend_.recall())[0]!.content).toBe("REST endpoints")
    expect((await frontend.recall())[0]!.content).toBe("React components")
  })

  it("child scope sees parent records with recursive=true", async () => {
    const root = new MemoryScope(backend, "/backend")
    await root.remember("inherited fact")
    const api = root.subscope("api")
    // api scope only sees records under /backend/api, not /backend
    const ownRecords = await api.recall({ recursive: false })
    expect(ownRecords).toHaveLength(0)
    // But parent sees all
    const parentRecords = await root.recall()
    expect(parentRecords).toHaveLength(1)
  })

  it("forget removes all records under a scope", async () => {
    const root = new MemoryScope(backend, "/backend")
    const api = root.subscope("api")
    await root.remember("backend-wide fact")
    await api.remember("api-specific fact")
    expect(await root.recall()).toHaveLength(2)
    await root.forget()
    expect(await root.recall()).toHaveLength(0)
  })

  it("listSubscopes returns direct children only", async () => {
    const root = new MemoryScope(backend, "/")
    await root.remember("x", "backend/api")
    await root.remember("y", "frontend/ui")
    await root.remember("z", "backend/db/migrations")
    const children = await root.listSubscopes()
    expect(children.sort()).toEqual(["backend", "frontend"])
  })
})

describe("ADR generator (借鉴 wshobson MADR)", () => {
  it("renders a complete ADR in MADR format", () => {
    const md = createADR({
      number: 1,
      title: "Use pnpm workspaces",
      status: "accepted",
      context: "Maximilian uses a monorepo with multiple packages.",
      drivers: ["fast installs", "disk-efficient"],
      options: [
        { name: "pnpm", description: "pnpm workspaces", pros: ["fast", "disk-efficient"], cons: ["less common"] },
        { name: "npm", description: "npm workspaces", pros: ["built-in"], cons: ["slower"] },
      ],
      decision: "pnpm",
      rationale: "Fastest install + lowest disk usage among the options.",
      consequences: {
        positive: ["Faster CI", "Less disk usage"],
        negative: ["Team must learn pnpm"],
        risks: ["Some npm plugins may not work"],
      },
      related: [],
      references: ["https://pnpm.io"],
    })
    expect(md).toMatch(/^# ADR-0001: Use pnpm workspaces/)
    expect(md).toContain("## Status")
    expect(md).toContain("✅ Accepted")
    expect(md).toContain("## Decision Drivers")
    expect(md).toContain("## Considered Options")
    expect(md).toContain("### Option 1: pnpm")
    expect(md).toContain("### Option 2: npm")
    expect(md).toContain("## Decision")
    expect(md).toContain("pnpm")
    expect(md).toContain("## Consequences")
    expect(md).toContain("### Positive")
    expect(md).toContain("### Negative")
    expect(md).toContain("### Risks")
    expect(md).toContain("## References")
  })

  it("creates an index README from a list of ADRs", () => {
    const index = createAdrIndex([
      { number: 1, title: "First", status: "accepted", context: "", decision: "x", rationale: "" },
      { number: 2, title: "Second", status: "proposed", context: "", decision: "y", rationale: "" },
    ])
    expect(index).toContain("# Architecture Decision Records")
    expect(index).toContain("| ADR-0001 | [First]")
    expect(index).toContain("| ADR-0002 | [Second]")
    expect(index).toContain("✅ Accepted")
    expect(index).toContain("🟡 Proposed")
  })

  it("parseAdr extracts fields from generated ADR", () => {
    const md = createADR({
      number: 42,
      title: "Test parse",
      status: "proposed",
      context: "Need to parse.",
      decision: "Use regex",
      rationale: "Simpler than AST.",
    })
    const parsed = parseAdr(md)
    expect(parsed.number).toBe(42)
    expect(parsed.title).toBe("Test parse")
    expect(parsed.status).toBe("proposed")
    expect(parsed.context).toBe("Need to parse.")
    expect(parsed.decision).toBe("Use regex")
  })
})

describe("Repo memory store (借鉴 codebase-memory-mcp)", () => {
  let baseDir: string
  let store: FileRepoMemoryStore
  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), "max-repo-mem-"))
    store = new FileRepoMemoryStore({ baseDir })
  })

  it("save/load roundtrip", async () => {
    await store.save("/repo/foo", "structure", { files: ["src/main.ts", "README.md"] })
    const loaded = await store.load("/repo/foo", "structure")
    expect(loaded).toBeDefined()
    expect(loaded!.content).toEqual({ files: ["src/main.ts", "README.md"] })
  })

  it("load returns undefined for missing key", async () => {
    expect(await store.load("/repo/missing", "nope")).toBeUndefined()
  })

  it("listKeys enumerates saved keys for a repo", async () => {
    await store.save("/repo/a", "structure", "x")
    await store.save("/repo/a", "build", "y")
    await store.save("/repo/b", "structure", "z")
    const keysA = await store.listKeys("/repo/a")
    expect(keysA.sort()).toEqual(["build", "structure"])
    const keysB = await store.listKeys("/repo/b")
    expect(keysB).toEqual(["structure"])
  })

  it("delete removes an entry", async () => {
    await store.save("/repo/x", "k", "v")
    expect(await store.delete("/repo/x", "k")).toBe(true)
    expect(await store.delete("/repo/x", "k")).toBe(false)
    expect(await store.load("/repo/x", "k")).toBeUndefined()
  })

  it("two repos do not share keys", async () => {
    await store.save("/repo/one", "structure", { files: [] })
    await store.save("/repo/two", "structure", { files: ["different"] })
    expect((await store.load("/repo/one", "structure"))!.content).toEqual({ files: [] })
    expect((await store.load("/repo/two", "structure"))!.content).toEqual({ files: ["different"] })
  })

  // Cleanup tmpdir after each test
  // (mkdtemp returns a fresh dir per test, but we also tear it down.)
  afterEach(async () => { await rm(baseDir, { recursive: true, force: true }) })
})