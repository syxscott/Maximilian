import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdtempSync, existsSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { LocalAdapter, type WorkspaceInfo } from "../src/adapter.js"

describe("LocalAdapter (借鉴 opencode - WorkspaceAdapter)", () => {
  let root: string
  let adapter: LocalAdapter

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "max-ws-"))
    adapter = new LocalAdapter(root)
  })

  afterEach(() => {
    try {
      rmSync(root, { recursive: true, force: true })
    } catch {
      // ignore
    }
  })

  it("create() makes directory under root", async () => {
    const info: WorkspaceInfo = {
      id: "w1",
      name: "w1",
      type: "local",
      directory: "sub",
      projectID: "p1",
    }
    await adapter.create(info)
    expect(existsSync(join(root, "sub"))).toBe(true)
  })

  it("create() throws on missing directory", async () => {
    await expect(
      adapter.create({
        id: "w1",
        name: "w1",
        type: "local",
        projectID: "p1",
      }),
    ).rejects.toThrow(/requires directory/)
  })

  it("remove() deletes directory and clears index", async () => {
    const info: WorkspaceInfo = {
      id: "w1",
      name: "w1",
      type: "local",
      directory: "sub",
      projectID: "p1",
    }
    await adapter.create(info)
    await adapter.remove(info)
    expect(existsSync(join(root, "sub"))).toBe(false)
    expect(await adapter.get("w1")).toBeUndefined()
  })

  it("list() returns all created workspaces", async () => {
    await adapter.create({
      id: "a",
      name: "a",
      type: "local",
      directory: "A",
      projectID: "p",
    })
    await adapter.create({
      id: "b",
      name: "b",
      type: "local",
      directory: "B",
      projectID: "p",
    })
    const list = await adapter.list()
    expect(list).toHaveLength(2)
    expect(list.map((i) => i.id).sort()).toEqual(["a", "b"])
  })

  it("hydrate() pre-populates the index", async () => {
    const items: WorkspaceInfo[] = [
      { id: "h1", name: "h1", type: "local", directory: "x", projectID: "p" },
      { id: "h2", name: "h2", type: "local", directory: "y", projectID: "p" },
    ]
    adapter.hydrate(items)
    expect((await adapter.get("h1"))?.directory).toBe("x")
    expect((await adapter.list()).length).toBe(2)
  })

  it("get() returns undefined for missing id", async () => {
    expect(await adapter.get("ghost")).toBeUndefined()
  })

  it("exposes name and description", () => {
    expect(adapter.name).toBe("local")
    expect(adapter.description).toBe("Local filesystem workspace")
  })
})