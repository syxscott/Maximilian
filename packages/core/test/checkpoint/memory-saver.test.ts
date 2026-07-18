// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

import { describe, it, expect, beforeEach } from "vitest"
import { MemoryCheckpointSaver } from "../../src/checkpoint/memory-saver.js"
import type { Checkpoint } from "../../src/checkpoint/saver.js"

function makeCheckpoint(overrides: Partial<Checkpoint> & { id: string; parentId: string | null }): Checkpoint {
  return {
    channelValues: {},
    channelVersions: {},
    updatedChannels: [],
    metadata: { source: "loop", step: 0 },
    ...overrides,
  }
}

describe("MemoryCheckpointSaver", () => {
  let saver: MemoryCheckpointSaver

  beforeEach(() => {
    saver = new MemoryCheckpointSaver()
  })

  it("stores and retrieves a checkpoint", async () => {
    const cp = makeCheckpoint({ id: "cp-1", parentId: null })
    await saver.put({ thread_id: "t1" }, cp, { foo: "bar" })
    const result = await saver.get({ thread_id: "t1", checkpoint_id: "cp-1" })
    expect(result).not.toBeUndefined()
    expect(result!.checkpoint.id).toBe("cp-1")
    expect(result!.checkpoint.parentId).toBeNull()
    expect(result!.metadata).toEqual({ foo: "bar" })
  })

  it("get without checkpoint_id returns latest", async () => {
    const cp1 = makeCheckpoint({ id: "cp-1", parentId: null })
    const cp2 = makeCheckpoint({ id: "cp-2", parentId: "cp-1" })
    await saver.put({ thread_id: "t1" }, cp1)
    await saver.put({ thread_id: "t1" }, cp2)
    const result = await saver.get({ thread_id: "t1" })
    expect(result).not.toBeUndefined()
    expect(result!.checkpoint.id).toBe("cp-2")
  })

  it("list returns checkpoints newest-first", async () => {
    const cp1 = makeCheckpoint({ id: "cp-1", parentId: null })
    const cp2 = makeCheckpoint({ id: "cp-2", parentId: "cp-1" })
    const cp3 = makeCheckpoint({ id: "cp-3", parentId: "cp-2" })
    await saver.put({ thread_id: "t1" }, cp1)
    await saver.put({ thread_id: "t1" }, cp2)
    await saver.put({ thread_id: "t1" }, cp3)
    const list = await saver.list({ thread_id: "t1" })
    expect(list.map((t) => t.checkpoint.id)).toEqual(["cp-3", "cp-2", "cp-1"])
  })

  it("list respects limit", async () => {
    const cp1 = makeCheckpoint({ id: "cp-1", parentId: null })
    const cp2 = makeCheckpoint({ id: "cp-2", parentId: "cp-1" })
    const cp3 = makeCheckpoint({ id: "cp-3", parentId: "cp-2" })
    await saver.put({ thread_id: "t1" }, cp1)
    await saver.put({ thread_id: "t1" }, cp2)
    await saver.put({ thread_id: "t1" }, cp3)
    const list = await saver.list({ thread_id: "t1" }, 2)
    expect(list).toHaveLength(2)
    expect(list[0]!.checkpoint.id).toBe("cp-3")
    expect(list[1]!.checkpoint.id).toBe("cp-2")
  })

  it("putWrites appends pending writes", async () => {
    const cp = makeCheckpoint({ id: "cp-1", parentId: null })
    await saver.put({ thread_id: "t1" }, cp)
    await saver.putWrites({ thread_id: "t1", checkpoint_id: "cp-1" }, [
      ["ch1", "val1"],
      ["ch2", "val2"],
    ])
    const result = await saver.get({ thread_id: "t1", checkpoint_id: "cp-1" })
    expect(result!.pendingWrites).toHaveLength(2)
    expect(result!.pendingWrites[0]).toEqual(["ch1", "val1", "write"])
    expect(result!.pendingWrites[1]).toEqual(["ch2", "val2", "write"])
  })

  it("copyThread duplicates the full chain", async () => {
    const cp1 = makeCheckpoint({ id: "cp-1", parentId: null })
    const cp2 = makeCheckpoint({ id: "cp-2", parentId: "cp-1" })
    await saver.put({ thread_id: "t1" }, cp1)
    await saver.put({ thread_id: "t1" }, cp2)

    await saver.copyThread({ thread_id: "t1" }, { thread_id: "t2" })

    const srcList = await saver.list({ thread_id: "t1" })
    const dstList = await saver.list({ thread_id: "t2" })
    expect(dstList).toHaveLength(srcList.length)
    // New ids are different from original ids
    expect(dstList[0]!.checkpoint.id).not.toBe("cp-2")
    expect(dstList[1]!.checkpoint.id).not.toBe("cp-1")
  })

  it("prune keeps only checkpoints before beforeId", async () => {
    const cp1 = makeCheckpoint({ id: "a", parentId: null })
    const cp2 = makeCheckpoint({ id: "b", parentId: "a" })
    const cp3 = makeCheckpoint({ id: "c", parentId: "b" })
    await saver.put({ thread_id: "t1" }, cp1)
    await saver.put({ thread_id: "t1" }, cp2)
    await saver.put({ thread_id: "t1" }, cp3)

    await saver.prune({ thread_id: "t1" }, "b")

    const list = await saver.list({ thread_id: "t1" })
    expect(list.map((t) => t.checkpoint.id)).toEqual(["c"])
  })

  it("prune without beforeId keeps only latest", async () => {
    const cp1 = makeCheckpoint({ id: "a", parentId: null })
    const cp2 = makeCheckpoint({ id: "b", parentId: "a" })
    const cp3 = makeCheckpoint({ id: "c", parentId: "b" })
    await saver.put({ thread_id: "t1" }, cp1)
    await saver.put({ thread_id: "t1" }, cp2)
    await saver.put({ thread_id: "t1" }, cp3)

    await saver.prune({ thread_id: "t1" })

    const list = await saver.list({ thread_id: "t1" })
    expect(list).toHaveLength(1)
    expect(list[0]!.checkpoint.id).toBe("c")
  })

  it("get returns undefined for unknown thread", async () => {
    const result = await saver.get({ thread_id: "unknown" })
    expect(result).toBeUndefined()
  })

  it("list returns empty array for unknown thread", async () => {
    const result = await saver.list({ thread_id: "unknown" })
    expect(result).toEqual([])
  })

  it("throws when thread_id is missing", async () => {
    await expect(saver.get({})).rejects.toThrow("thread_id")
    await expect(saver.put({}, makeCheckpoint({ id: "x", parentId: null }))).rejects.toThrow("thread_id")
  })

  it("copyThread throws when src === dst", async () => {
    await expect(
      saver.copyThread({ thread_id: "t1" }, { thread_id: "t1" }),
    ).rejects.toThrow("must differ")
  })
})
