import { mkdir, mkdtemp, open, rm, stat, utimes } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { withFileLock } from "../src/index.js"

const tempDirs: string[] = []

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("withFileLock", () => {
  it("serializes concurrent critical sections", async () => {
    const lockPath = path.join(await makeTempDir("credential-lease-lock-"), "auth.lock")
    let active = 0
    let maxActive = 0
    await Promise.all(
      Array.from({ length: 12 }, () =>
        withFileLock(
          lockPath,
          async () => {
            active += 1
            maxActive = Math.max(maxActive, active)
            await new Promise((resolve) => setTimeout(resolve, 5))
            active -= 1
          },
          { timeoutMs: 5000 },
        ),
      ),
    )
    expect(maxActive).toBe(1)
  })

  it("removes the lock file after the operation releases it", async () => {
    const dir = await makeTempDir("credential-lease-lock-")
    const lockPath = path.join(dir, "auth.lock")
    await withFileLock(lockPath, async () => "done")
    await expect(stat(lockPath)).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("releases the lock when the operation throws", async () => {
    const lockPath = path.join(await makeTempDir("credential-lease-lock-"), "auth.lock")
    await expect(
      withFileLock(lockPath, async () => {
        throw new Error("operation failed")
      }),
    ).rejects.toThrow("operation failed")
    await expect(withFileLock(lockPath, async () => "reacquired")).resolves.toBe("reacquired")
  })

  it("waits for a held lock and acquires it once released", async () => {
    const lockPath = path.join(await makeTempDir("credential-lease-lock-"), "auth.lock")
    const holder = await open(lockPath, "wx", 0o600)
    const acquisition = withFileLock(lockPath, async () => "acquired", { timeoutMs: 5000 })
    setTimeout(() => void holder.close().then(() => rm(lockPath, { force: true })), 30)
    await expect(acquisition).resolves.toBe("acquired")
  })

  it("times out while the lock is held elsewhere", async () => {
    const dir = await makeTempDir("credential-lease-lock-")
    const lockPath = path.join(dir, "auth.lock")
    const holder = await open(lockPath, "wx", 0o600)
    try {
      await expect(withFileLock(lockPath, async () => "never", { timeoutMs: 80 })).rejects.toThrow(
        /Timed out acquiring credential lease lock/u,
      )
    } finally {
      await holder.close()
      await rm(lockPath, { force: true })
    }
  })

  it("breaks a stale lock left behind by a dead holder", async () => {
    const dir = await makeTempDir("credential-lease-lock-")
    const lockPath = path.join(dir, "auth.lock")
    const handle = await open(lockPath, "wx", 0o600)
    await handle.close()
    const stale = new Date(Date.now() - 60_000)
    await utimes(lockPath, stale, stale)
    await expect(
      withFileLock(lockPath, async () => "stale-broken", { staleMs: 1000, timeoutMs: 2000 }),
    ).resolves.toBe("stale-broken")
  })

  it("propagates lock-file creation errors that are not contention", async () => {
    const dir = await makeTempDir("credential-lease-lock-")
    // A basename beyond the filesystem's 255-byte limit makes exclusive
    // creation fail with ENAMETOOLONG, which must surface instead of being
    // treated as a held lock.
    const lockPath = path.join(dir, "x".repeat(300))
    await expect(withFileLock(lockPath, async () => "never")).rejects.toMatchObject({
      code: "ENAMETOOLONG",
    })
  })
})
