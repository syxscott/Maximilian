// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT

import { describe, expect, it, vi } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import {
  HydrationInvalidatedError,
  readWithHydrationRetry,
  readWithHydrationRetryAsync,
} from "../src/hydration-retry.js"
import { SessionStore } from "../src/index.js"

describe("readWithHydrationRetry — pure model with injected probe", () => {
  it("reads once when the version is stable across the read", () => {
    const probe = vi.fn(() => 7)
    const read = vi.fn(() => "snapshot")
    expect(readWithHydrationRetry(probe, read)).toBe("snapshot")
    expect(read).toHaveBeenCalledTimes(1)
    expect(probe).toHaveBeenCalledTimes(2)
  })

  it("retries the COMPLETE read once when the version moves mid-hydration", () => {
    let version = 1
    const probe = () => version
    let reads = 0
    const result = readWithHydrationRetry(probe, () => {
      reads += 1
      if (reads === 1) version = 2 // a concurrent write landed during hydration
      return `snapshot-${reads}`
    })
    // The retry re-reads everything and sees the post-write state.
    expect(result).toBe("snapshot-2")
    expect(reads).toBe(2)
  })

  it("throws HydrationInvalidatedError when invalidated on the retry too", () => {
    let version = 1
    const probe = () => version
    let reads = 0
    expect(() =>
      readWithHydrationRetry(probe, () => {
        reads += 1
        version += 1 // keeps moving underneath every read
        return reads
      }),
    ).toThrow(HydrationInvalidatedError)
    expect(reads).toBe(2) // exactly one retry, then the error
  })

  it("the error reports the attempt count", () => {
    const err = new HydrationInvalidatedError(2)
    expect(err.attempts).toBe(2)
    expect(err.name).toBe("HydrationInvalidatedError")
  })

  it("does not mask exceptions thrown by the read itself", () => {
    expect(() =>
      readWithHydrationRetry(
        () => 1,
        () => {
          throw new Error("hydration dependency missing")
        },
      ),
    ).toThrow("hydration dependency missing")
  })

  it("honors maxRetries for callers with a measured reason", () => {
    let version = 1
    let reads = 0
    const result = readWithHydrationRetry(
      () => version,
      () => {
        reads += 1
        // Three consecutive invalidations, then the world settles.
        if (reads <= 3) version += 1
        return reads
      },
      { maxRetries: 3 },
    )
    expect(reads).toBe(4)
    expect(result).toBe(4)
    // The default budget (1) would NOT have survived three invalidations.
    expect(() =>
      readWithHydrationRetry(
        () => version,
        () => {
          version += 1
          return version
        },
      ),
    ).toThrow(HydrationInvalidatedError)
  })

  it("string probes work the same way", () => {
    let rev = "r1"
    let reads = 0
    const result = readWithHydrationRetry(
      () => rev,
      () => {
        reads += 1
        if (reads === 1) rev = "r2"
        return { reads }
      },
    )
    expect(result.reads).toBe(2)
  })
})

describe("readWithHydrationRetryAsync", () => {
  it("retries once around async probe/read pairs", async () => {
    let rev = 0
    let reads = 0
    const result = await readWithHydrationRetryAsync(
      async () => rev,
      async () => {
        reads += 1
        if (reads === 1) rev = 9
        return reads
      },
    )
    expect(result).toBe(2)
  })

  it("errors after a second invalidation", async () => {
    let rev = 0
    await expect(
      readWithHydrationRetryAsync(
        async () => rev,
        async () => {
          rev += 1
          return rev
        },
      ),
    ).rejects.toThrow(HydrationInvalidatedError)
  })
})

describe("SessionStore.readConsistent — real data_version probe", () => {
  function tmpDbPath(): string {
    return path.join(os.tmpdir(), `hydration-retry-${Date.now()}-${Math.random()}.db`)
  }

  it("data_version moves when another connection writes, not on own writes", () => {
    const file = tmpDbPath()
    try {
      const a = new SessionStore({ path: file }).migrate()
      const b = new SessionStore({ path: file }).migrate()
      const before = a.dataVersion
      a.appendSession({ id: "s1", workspaceId: "w" }) // own write: no bump
      expect(a.dataVersion).toBe(before)
      b.appendSession({ id: "s2", workspaceId: "w" }) // other connection: bump
      expect(a.dataVersion).toBeGreaterThan(before)
      a.close()
      b.close()
    } finally {
      fs.rmSync(file, { force: true })
      fs.rmSync(`${file}-wal`, { force: true })
      fs.rmSync(`${file}-shm`, { force: true })
    }
  })

  it("re-reads the projection once when another connection commits mid-read", () => {
    const file = tmpDbPath()
    try {
      const reader = new SessionStore({ path: file }).migrate()
      const writer = new SessionStore({ path: file }).migrate()
      writer.appendSession({ id: "s1", workspaceId: "w", title: "before" })
      reader.appendSession({ id: "s1", workspaceId: "w", title: "before" })

      let reads = 0
      const projection = reader.readConsistent(() => {
        reads += 1
        const first = reader.getSession("s1")
        // The concurrent write lands BETWEEN our two reads.
        if (reads === 1) writer.appendSession({ id: "s1", workspaceId: "w", title: "after" })
        const second = reader.getSession("s1")
        return { first, second }
      })
      expect(reads).toBe(2)
      // The retry saw a stable world: both reads inside it agree.
      expect(projection.first?.title).toBe("after")
      expect(projection.second?.title).toBe("after")
      reader.close()
      writer.close()
    } finally {
      fs.rmSync(file, { force: true })
      fs.rmSync(`${file}-wal`, { force: true })
      fs.rmSync(`${file}-shm`, { force: true })
    }
  })

  it("still errors when the underlying store keeps moving", () => {
    const file = tmpDbPath()
    try {
      const reader = new SessionStore({ path: file }).migrate()
      const writer = new SessionStore({ path: file }).migrate()
      let reads = 0
      expect(() =>
        reader.readConsistent(() => {
          reads += 1
          writer.appendSession({ id: `s${reads}`, workspaceId: "w" })
          return reads
        }),
      ).toThrow(HydrationInvalidatedError)
      expect(reads).toBe(2)
      reader.close()
      writer.close()
    } finally {
      fs.rmSync(file, { force: true })
      fs.rmSync(`${file}-wal`, { force: true })
      fs.rmSync(`${file}-shm`, { force: true })
    }
  })
})
