import { mkdir, mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { atomicWritePrivateFile } from "../src/index.js"

const tempDirs: string[] = []

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("atomicWritePrivateFile", () => {
  it("writes content with mode 0600 into a 0700 directory", async () => {
    const dir = await makeTempDir("credential-lease-atomic-")
    const target = path.join(dir, "state", "auth-state.json")
    await atomicWritePrivateFile(target, '{"status":"anonymous"}')
    expect((await stat(target)).mode & 0o777).toBe(0o600)
    expect((await stat(path.dirname(target))).mode & 0o777).toBe(0o700)
    expect(await readFile(target, "utf8")).toBe('{"status":"anonymous"}')
  })

  it("creates nested missing parent directories", async () => {
    const dir = await makeTempDir("credential-lease-atomic-")
    const target = path.join(dir, "a", "b", "c", "state.json")
    await atomicWritePrivateFile(target, "x")
    expect(await readFile(target, "utf8")).toBe("x")
  })

  it("forces an existing wider-mode target back to 0600", async () => {
    const dir = await makeTempDir("credential-lease-atomic-")
    const target = path.join(dir, "state.json")
    await atomicWritePrivateFile(target, "first")
    const { chmod } = await import("node:fs/promises")
    await chmod(target, 0o644)
    await atomicWritePrivateFile(target, "second")
    expect((await stat(target)).mode & 0o777).toBe(0o600)
    expect(await readFile(target, "utf8")).toBe("second")
  })

  it("forces an existing wider-mode parent directory back to 0700", async () => {
    const dir = await makeTempDir("credential-lease-atomic-")
    const nested = path.join(dir, "run")
    await mkdir(nested, { mode: 0o755 })
    const target = path.join(nested, "state.json")
    await atomicWritePrivateFile(target, "x")
    expect((await stat(nested)).mode & 0o777).toBe(0o700)
  })

  it("replaces content without leaving temporary files behind", async () => {
    const dir = await makeTempDir("credential-lease-atomic-")
    const target = path.join(dir, "state.json")
    await atomicWritePrivateFile(target, "first")
    await atomicWritePrivateFile(target, "second")
    expect(await readdir(path.dirname(target))).toEqual(["state.json"])
  })

  it("survives concurrent writes to the same target", async () => {
    // Regression: the temp-file name once carried only pid + Date.now(), so two
    // writes started in the same millisecond collided on exclusive create (EEXIST)
    // and failed whole auth-state transitions.
    const dir = await makeTempDir("credential-lease-atomic-")
    const target = path.join(dir, "state.json")
    const writes = Array.from({ length: 12 }, (_, index) =>
      atomicWritePrivateFile(target, `{"n":${index}}`),
    )
    await expect(Promise.all(writes)).resolves.toBeDefined()
    expect(await readFile(target, "utf8")).toMatch(/^\{"n":\d+\}$/)
    expect(await readdir(path.dirname(target))).toEqual(["state.json"])
  })
})
