// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Tests for the message sibling-version index (deepseek chat-demo
 * borrowing, port of branches.ts buildMessageVersions): linear-list
 * semantics, tree grouping by parent, and the previous-map reuse.
 */

import { describe, expect, it } from "vitest"
import { buildMessageVersions } from "../src/index.js"

describe("buildMessageVersions", () => {
  it("treats a list without parent links as linear — every row a singleton", () => {
    const items = [
      { id: "a", parentId: null, selectedChildId: null },
      { id: "b", parentId: null, selectedChildId: null },
      { id: "c", parentId: null, selectedChildId: null },
    ]
    const versions = buildMessageVersions(items)
    expect(versions.get("a")).toEqual({ ids: ["a"], index: 0 })
    expect(versions.get("b")).toEqual({ ids: ["b"], index: 0 })
    expect(versions.get("c")).toEqual({ ids: ["c"], index: 0 })
    // Singleton groups never overlap — each row owns its own ids array.
    expect(versions.get("a")?.ids).not.toBe(versions.get("b")?.ids)
  })

  it("also handles rows with the tree fields simply absent", () => {
    const versions = buildMessageVersions([{ id: "a" }, { id: "b" }])
    expect(versions.get("a")).toEqual({ ids: ["a"], index: 0 })
    expect(versions.get("b")).toEqual({ ids: ["b"], index: 0 })
  })

  it("groups siblings by parent and indexes each row inside its group", () => {
    // a is the root; b/b2 are siblings under a; c hangs off b.
    const items = [
      { id: "a", parentId: null, selectedChildId: "b" },
      { id: "b", parentId: "a", selectedChildId: "c" },
      { id: "b2", parentId: "a", selectedChildId: null },
      { id: "c", parentId: "b", selectedChildId: null },
    ]
    const versions = buildMessageVersions(items)
    expect(versions.get("b")).toEqual({ ids: ["b", "b2"], index: 0 })
    expect(versions.get("b2")).toEqual({ ids: ["b", "b2"], index: 1 })
    // Root rows group under the null parent key — a lone root is a singleton.
    expect(versions.get("a")).toEqual({ ids: ["a"], index: 0 })
    expect(versions.get("c")).toEqual({ ids: ["c"], index: 0 })
  })

  it("groups multiple null-parent roots as siblings of each other", () => {
    const items = [
      { id: "r1", parentId: null, selectedChildId: null },
      { id: "r2", parentId: null, selectedChildId: null },
      { id: "x", parentId: "r1", selectedChildId: null },
    ]
    const versions = buildMessageVersions(items)
    expect(versions.get("r1")).toEqual({ ids: ["r1", "r2"], index: 0 })
    expect(versions.get("r2")).toEqual({ ids: ["r1", "r2"], index: 1 })
    expect(versions.get("x")).toEqual({ ids: ["x"], index: 0 })
  })

  it("reuses the previous map (identity) when nothing changed", () => {
    const items = [
      { id: "a", parentId: null, selectedChildId: "b" },
      { id: "b", parentId: "a", selectedChildId: null },
    ]
    const first = buildMessageVersions(items)
    const second = buildMessageVersions(items, first)
    expect(second).toBe(first)
  })

  it("reuses cached version objects for untouched groups when a sibling appears", () => {
    const before = [
      { id: "a", parentId: null, selectedChildId: "b" },
      { id: "b", parentId: "a", selectedChildId: "c" },
      { id: "b2", parentId: "a", selectedChildId: null },
      { id: "c", parentId: "b", selectedChildId: null },
    ]
    const first = buildMessageVersions(before)

    const after = [...before, { id: "b3", parentId: "a", selectedChildId: null }]
    const second = buildMessageVersions(after, first)

    // b's group grew: new ids array, new version objects.
    expect(second).not.toBe(first)
    expect(second.get("b")).toEqual({ ids: ["b", "b2", "b3"], index: 0 })
    expect(second.get("b2")).toEqual({ ids: ["b", "b2", "b3"], index: 1 })
    expect(second.get("b3")).toEqual({ ids: ["b", "b2", "b3"], index: 2 })
    expect(second.get("b")?.ids).not.toBe(first.get("b")?.ids)
    // c's group is untouched — the exact cached version object is reused.
    expect(second.get("c")).toBe(first.get("c"))
    expect(second.get("c")?.ids).toBe(first.get("c")?.ids)
  })
})
