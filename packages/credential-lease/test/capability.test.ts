import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { createCapability, writeCapabilityFile } from "../src/index.js"

const tempDirs: string[] = []

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("capability file", () => {
  it("creates 32 random bytes encoded as lowercase hex", () => {
    const first = createCapability()
    const second = createCapability()
    expect(first).toMatch(/^[a-f0-9]{64}$/)
    expect(second).toMatch(/^[a-f0-9]{64}$/)
    expect(first).not.toEqual(second)
    expect(Buffer.from(first, "hex")).toHaveLength(32)
  })

  it("writes the capability with mode 0600 into a 0700 run directory", async () => {
    const dir = await makeTempDir("credential-lease-cap-")
    const capabilityFile = path.join(dir, "run", "credential-lease-v1.cap")
    await writeCapabilityFile(capabilityFile, createCapability())
    expect((await stat(capabilityFile)).mode & 0o777).toBe(0o600)
    expect((await stat(path.dirname(capabilityFile))).mode & 0o777).toBe(0o700)
    const content = await readFile(capabilityFile, "utf8")
    expect(content.endsWith("\n")).toBe(true)
    expect(content.trim()).toMatch(/^[a-f0-9]{64}$/)
  })

  it("replaces the capability atomically without leaving temp files behind", async () => {
    const dir = await makeTempDir("credential-lease-cap-")
    const capabilityFile = path.join(dir, "run", "credential-lease-v1.cap")
    await writeCapabilityFile(capabilityFile, "a".repeat(64))
    await writeCapabilityFile(capabilityFile, "b".repeat(64))
    expect((await readFile(capabilityFile, "utf8")).trim()).toBe("b".repeat(64))
    expect(await readdir(path.dirname(capabilityFile))).toEqual(["credential-lease-v1.cap"])
  })

  it("rejects malformed capability values without creating the file", async () => {
    const dir = await makeTempDir("credential-lease-cap-")
    const capabilityFile = path.join(dir, "run", "credential-lease-v1.cap")
    await expect(writeCapabilityFile(capabilityFile, "too-short")).rejects.toMatchObject({
      code: "INVALID_REQUEST",
    })
    await expect(writeCapabilityFile(capabilityFile, "g".repeat(64))).rejects.toMatchObject({
      code: "INVALID_REQUEST",
    })
    await expect(stat(capabilityFile)).rejects.toMatchObject({ code: "ENOENT" })
  })
})
