// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { layoutKahn, type GraphNode, type GraphEdge } from "./graph-layout";

describe("Borrowed — graph-layout", () => {
  it("returns empty layout for empty graph", () => {
    const r = layoutKahn([], []);
    expect(r.positions.size).toBe(0);
    expect(r.cycles).toHaveLength(0);
  });

  it("lays out a linear chain in columns", () => {
    const nodes: GraphNode[] = [
      { id: "a" },
      { id: "b" },
      { id: "c" },
    ];
    const edges: GraphEdge[] = [
      { source: "a", target: "b" },
      { source: "b", target: "c" },
    ];
    const r = layoutKahn(nodes, edges);
    const a = r.positions.get("a");
    const b = r.positions.get("b");
    const c = r.positions.get("c");
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(c).toBeDefined();
    // Each step moves to a new column.
    expect(a!.x).toBeLessThan(b!.x);
    expect(b!.x).toBeLessThan(c!.x);
    // Same row.
    expect(a!.y).toBe(b!.y);
    expect(b!.y).toBe(c!.y);
  });

  it("lays out a diamond with siblings in the same column", () => {
    const nodes: GraphNode[] = [
      { id: "root" },
      { id: "left" },
      { id: "right" },
      { id: "leaf" },
    ];
    const edges: GraphEdge[] = [
      { source: "root", target: "left" },
      { source: "root", target: "right" },
      { source: "left", target: "leaf" },
      { source: "right", target: "leaf" },
    ];
    const r = layoutKahn(nodes, edges);
    const root = r.positions.get("root")!;
    const left = r.positions.get("left")!;
    const right = r.positions.get("right")!;
    const leaf = r.positions.get("leaf")!;
    // left and right are siblings — same column, different rows.
    expect(left.x).toBe(right.x);
    expect(left.y).not.toBe(right.y);
    // root is column 0; left/right column 1; leaf column 2.
    expect(root.x).toBeLessThan(left.x);
    expect(left.x).toBeLessThan(leaf.x);
    expect(leaf.x).toBeGreaterThan(root.x);
  });

  it("detects cycles and pushes them to a remaining column", () => {
    const nodes: GraphNode[] = [
      { id: "a" },
      { id: "b" },
      { id: "c" },
    ];
    const edges: GraphEdge[] = [
      { source: "a", target: "b" },
      { source: "b", target: "c" },
      { source: "c", target: "a" }, // cycle
    ];
    const r = layoutKahn(nodes, edges);
    // No node is reachable from a "root" (in-degree zero) — they all
    // get pushed to the remaining column.
    expect(r.positions.size).toBe(3);
    // The layout still produced a single "remaining" column.
    expect(r.cycles.length).toBeGreaterThan(0);
  });

  it("handles disconnected components in separate columns", () => {
    const nodes: GraphNode[] = [
      { id: "a" },
      { id: "b" },
      { id: "c" },
      { id: "d" },
    ];
    const edges: GraphEdge[] = [
      { source: "a", target: "b" },
      { source: "c", target: "d" },
    ];
    const r = layoutKahn(nodes, edges);
    expect(r.positions.size).toBe(4);
    // 2 chains → at least 2 columns.
    expect(r.columnCount).toBeGreaterThanOrEqual(2);
  });

  it("ignores edges that reference unknown nodes", () => {
    const nodes: GraphNode[] = [{ id: "a" }];
    const edges: GraphEdge[] = [{ source: "a", target: "ghost" }];
    const r = layoutKahn(nodes, edges);
    expect(r.positions.size).toBe(1);
    expect(r.cycles).toHaveLength(0);
  });
});