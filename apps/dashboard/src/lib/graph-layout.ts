/**
 * Pure-function Kahn-style graph layout (borrowed from voicetree
 * `packages/libraries/graph-model/src/pure/graph/positioning/`).
 *
 * Background: voicetree separates the *layout algorithm* from the
 * renderer (Cytoscape), making the layout unit-testable without a
 * DOM. The library uses `findBestPosition`, `packComponents`, and a
 * spatial index for collision queries.
 *
 * Maximilian's adaptation: a `layoutKahn` function that takes a graph
 * spec + options and returns a `Map<id, { x, y }>`. Pure, deterministic,
 * testable. No DOM, no React, no Ink.
 *
 * Tradeoffs (kept honest):
 *   - This is a *level-based* layout. Nodes in the same level share a
 *     column; siblings stack vertically.
 *   - Cycles are detected and any in-cycle nodes are pushed to an
 *     extra "remaining" column at the end (matching Maximilian's
 *     existing ExecutionCanvas.tsx:134 behaviour).
 *   - No collision detection across components yet (would need
 *     `findBestPosition.ts` from voicetree for full parity).
 */

export interface GraphNode {
  id: string;
  /** Optional display width; defaults to 180. */
  width?: number;
  /** Optional display height; defaults to 72. */
  height?: number;
}

export interface GraphEdge {
  source: string;
  target: string;
}

export interface GraphLayoutOptions {
  /** Horizontal gap between columns. Default: 120. */
  gapX?: number;
  /** Vertical gap between sibling rows. Default: 20. */
  gapY?: number;
  /** Padding around the canvas. Default: 40. */
  padding?: number;
}

export interface LayoutResult {
  positions: Map<string, { x: number; y: number }>;
  width: number;
  height: number;
  /** Detected cycles (array of node-ids; empty if DAG). */
  cycles: string[][];
  /** Number of columns (including the "remaining" column for in-cycle nodes). */
  columnCount: number;
}

export function layoutKahn(
  nodes: ReadonlyArray<GraphNode>,
  edges: ReadonlyArray<GraphEdge>,
  opts: GraphLayoutOptions = {},
): LayoutResult {
  const gapX = opts.gapX ?? 120;
  const gapY = opts.gapY ?? 20;
  const pad = opts.padding ?? 40;

  if (nodes.length === 0) {
    return { positions: new Map(), width: 0, height: 0, cycles: [], columnCount: 0 };
  }

  const nodeIds = new Set(nodes.map((n) => n.id));
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const n of nodes) {
    inDegree.set(n.id, 0);
    adj.set(n.id, []);
  }
  for (const e of edges) {
    if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) continue;
    adj.get(e.source)!.push(e.target);
    inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
  }

  // Kahn's algorithm with cycle detection.
  const levels: string[][] = [];
  const visited = new Set<string>();
  let queue: string[] = nodes
    .filter((n) => (inDegree.get(n.id) ?? 0) === 0)
    .map((n) => n.id);

  // Mark visited BEFORE descending so a back-edge during the same level
  // pass doesn't re-enqueue an already-visited node.
  while (queue.length > 0) {
    levels.push(queue);
    for (const id of queue) visited.add(id);
    const next: string[] = [];
    for (const id of queue) {
      for (const target of adj.get(id) ?? []) {
        if (visited.has(target)) continue;
        const deg = (inDegree.get(target) ?? 1) - 1;
        inDegree.set(target, deg);
        if (deg === 0 && !visited.has(target)) next.push(target);
      }
    }
    queue = next;
  }

  // Any unvisited node is part of a cycle (or an isolated component with
  // no inbound edges that we missed). Collect them.
  const remaining: string[] = [];
  for (const n of nodes) {
    if (!visited.has(n.id)) remaining.push(n.id);
  }
  // Detect cycles via Tarjan-style SCC on remaining nodes.
  const cycles = detectCycles(remaining, adj);
  if (remaining.length > 0) levels.push(remaining);

  // Assign positions.
  const positions = new Map<string, { x: number; y: number }>();
  let maxH = 0;
  for (let col = 0; col < levels.length; col++) {
    const level = levels[col]!;
    for (let row = 0; row < level.length; row++) {
      const id = level[row]!;
      const n = nodes.find((x) => x.id === id);
      const w = n?.width ?? 180;
      const h = n?.height ?? 72;
      positions.set(id, {
        x: pad + col * (w + gapX),
        y: pad + row * (h + gapY),
      });
      maxH = Math.max(maxH, pad + row * (h + gapY) + h + pad);
    }
  }
  const width = pad + levels.length * 180 + Math.max(0, levels.length - 1) * gapX + pad;
  const height = Math.max(maxH, 300);
  return { positions, width, height, cycles, columnCount: levels.length };
}

/**
 * Detect simple cycles in the sub-graph induced by `nodes`. We use a
 * DFS-with-colouring algorithm; returns one representative cycle per
 * strongly-connected component of size >= 2 (or self-loops).
 */
function detectCycles(
  nodes: string[],
  adj: Map<string, string[]>,
): string[][] {
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const onStack = new Set<string>();
  const stack: string[] = [];

  function dfs(u: string): void {
    visited.add(u);
    onStack.add(u);
    stack.push(u);
    for (const v of adj.get(u) ?? []) {
      if (!visited.has(v)) {
        dfs(v);
      } else if (onStack.has(v)) {
        // Found a cycle — extract it from the stack.
        const idx = stack.indexOf(v);
        if (idx >= 0) {
          cycles.push(stack.slice(idx));
        }
      }
    }
    stack.pop();
    onStack.delete(u);
  }

  for (const n of nodes) {
    if (!visited.has(n)) dfs(n);
  }
  return cycles;
}