import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { execSync } from "node:child_process"
import { SnapshotSaver } from "../../src/checkpoint/snapshot-saver.js"

function initRepo(dir: string) {
  execSync("git init -q && git config user.email t@t && git config user.name t", {
    cwd: dir,
  })
  writeFileSync(join(dir, "a.txt"), "v1")
  execSync("git add . && git commit -q -m init", { cwd: dir })
}

function readFile(path: string): string {
  return require("node:fs").readFileSync(path, "utf8")
}

describe("SnapshotSaver (借鉴 opencode)", () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "max-snap-"))
    initRepo(dir)
  })

  afterEach(() => {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // ignore
    }
  })

  it("track() returns undefined on no changes", () => {
    const s = new SnapshotSaver(dir)
    expect(s.track()).toBeUndefined()
  })

  it("track() captures changes and restore() reverts to baseline", () => {
    // 语义: track() 记录 "当前偏离 baseline 的 patch";
    // restore() 必须紧跟 track() 才有意义(还没进一步修改文件)。
    const s = new SnapshotSaver(dir)
    writeFileSync(join(dir, "a.txt"), "v2")
    const hash = s.track()
    expect(hash).toBeTruthy()
    s.restore(hash!)
    expect(readFile(join(dir, "a.txt"))).toBe("v1") // 回到 baseline
  })

  it("restore() can be chained (track → restore → track → restore)", () => {
    const s = new SnapshotSaver(dir)
    writeFileSync(join(dir, "a.txt"), "v2")
    const h1 = s.track()
    s.restore(h1!)
    expect(readFile(join(dir, "a.txt"))).toBe("v1")
    // 再次修改
    writeFileSync(join(dir, "a.txt"), "v3")
    const h2 = s.track()
    expect(h2).toBeTruthy()
    s.restore(h2!)
    expect(readFile(join(dir, "a.txt"))).toBe("v1")
  })

  it("diff() returns patch text", () => {
    const s = new SnapshotSaver(dir)
    writeFileSync(join(dir, "a.txt"), "v2")
    const hash = s.track()!
    const patch = s.diff(hash)
    expect(patch).toContain("a.txt")
  })

  it("restore() throws on unknown snapshot", () => {
    const s = new SnapshotSaver(dir)
    expect(() => s.restore("nonexistent")).toThrow(/Snapshot not found/)
  })

  it("list() returns tracked snapshots sorted by mtime desc", async () => {
    const s = new SnapshotSaver(dir)
    writeFileSync(join(dir, "a.txt"), "v2")
    const h1 = s.track()!
    await new Promise((r) => setTimeout(r, 15))
    writeFileSync(join(dir, "a.txt"), "v3")
    const h2 = s.track()!
    const list = s.list()
    expect(list.map((i) => i.hash)).toContain(h1)
    expect(list.map((i) => i.hash)).toContain(h2)
    expect(list[0]!.hash).toBe(h2) // 最新在前
  })

  it("list() includes parsed files from patch", () => {
    const s = new SnapshotSaver(dir)
    writeFileSync(join(dir, "a.txt"), "v2")
    writeFileSync(join(dir, "b.txt"), "new")
    const hash = s.track()!
    const list = s.list()
    const snap = list.find((i) => i.hash === hash)!
    expect(snap.files).toContain("a.txt")
    expect(snap.files).toContain("b.txt")
  })
})