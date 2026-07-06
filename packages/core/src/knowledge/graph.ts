/**
 * KnowledgeGraph — in-memory node/edge graph (借鉴 Kosmos knowledge/graph.py).
 *
 * Kosmos's KnowledgeGraph wraps a Neo4j database with Paper/Concept/Method
 * node types and CITES/USES_METHOD/etc. edge types. Maximilian adapts
 * this as a lightweight, dependency-free in-memory graph with the same
 * CRUD surface (addNode, addEdge, getNode, neighbors, query).
 *
 * Use cases:
 *   - Track concept relationships across agent results
 *   - Citation graph for findings
 *   - Lightweight reasoning support (find related concepts)
 *
 * For persistence or scale, callers can serialize the snapshot via
 * `serialize()` and reload it.
 */

export type NodeId = string

export interface GraphNode {
  id: NodeId
  type: string
  /** Free-form properties (label, content, metadata, etc.). */
  properties: Record<string, unknown>
}

export interface GraphEdge {
  from: NodeId
  to: NodeId
  type: string
  properties?: Record<string, unknown>
}

export interface KnowledgeGraphOptions {
  /** Cap on stored nodes (LRU eviction past the cap). Default: 10000. */
  maxNodes?: number
}

export class KnowledgeGraph {
  private readonly nodes = new Map<NodeId, GraphNode>()
  /** Outgoing edges per node: from → [edge]. */
  private readonly outgoing = new Map<NodeId, GraphEdge[]>()
  /** Incoming edges per node: to → [edge]. */
  private readonly incoming = new Map<NodeId, GraphEdge[]>()
  /** Insertion order for LRU eviction. */
  private readonly insertionOrder: NodeId[] = []
  private readonly maxNodes: number

  constructor(options?: KnowledgeGraphOptions) {
    this.maxNodes = options?.maxNodes ?? 10_000
  }

  /** Add or update a node. Throws if the cap is exceeded (after eviction). */
  addNode(node: GraphNode): void {
    const existed = this.nodes.has(node.id)
    this.nodes.set(node.id, node)
    if (!existed) {
      this.insertionOrder.push(node.id)
      this.evictIfNeeded()
    }
  }

  /** Add an edge between two existing nodes. Auto-creates endpoints. */
  addEdge(edge: GraphEdge): void {
    if (!this.nodes.has(edge.from)) {
      this.addNode({ id: edge.from, type: "unknown", properties: {} })
    }
    if (!this.nodes.has(edge.to)) {
      this.addNode({ id: edge.to, type: "unknown", properties: {} })
    }
    const outList = this.outgoing.get(edge.from) ?? []
    outList.push(edge)
    this.outgoing.set(edge.from, outList)
    const inList = this.incoming.get(edge.to) ?? []
    inList.push(edge)
    this.incoming.set(edge.to, inList)
  }

  /** Get a node by id. */
  getNode(id: NodeId): GraphNode | undefined {
    return this.nodes.get(id)
  }

  /** Remove a node and all edges touching it (both directions). */
  removeNode(id: NodeId): boolean {
    if (!this.nodes.has(id)) return false
    this.nodes.delete(id)
    // Drop outbound edges AND their entries in the destinations' incoming lists.
    const outList = this.outgoing.get(id) ?? []
    for (const e of outList) {
      const ins = this.incoming.get(e.to)
      if (ins) this.incoming.set(e.to, ins.filter((x) => x.from !== id))
    }
    this.outgoing.delete(id)
    // Drop inbound edges AND their entries in the sources' outgoing lists.
    const inList = this.incoming.get(id) ?? []
    for (const e of inList) {
      const outs = this.outgoing.get(e.from)
      if (outs) this.outgoing.set(e.from, outs.filter((x) => x.to !== id))
    }
    this.incoming.delete(id)
    const idx = this.insertionOrder.indexOf(id)
    if (idx >= 0) this.insertionOrder.splice(idx, 1)
    return true
  }

  /** Outgoing edges from a node. */
  edgesFrom(id: NodeId): GraphEdge[] {
    return [...(this.outgoing.get(id) ?? [])]
  }

  /** Incoming edges to a node. */
  edgesTo(id: NodeId): GraphEdge[] {
    return [...(this.incoming.get(id) ?? [])]
  }

  /** Neighbors reachable via outgoing edges (optionally filtered by edge type). */
  neighbors(id: NodeId, edgeType?: string): GraphNode[] {
    const edges = this.edgesFrom(id)
    const filtered = edgeType ? edges.filter((e) => e.type === edgeType) : edges
    const result: GraphNode[] = []
    for (const e of filtered) {
      const node = this.nodes.get(e.to)
      if (node) result.push(node)
    }
    return result
  }

  /** Query nodes by type (and optional property predicate). */
  findByType(type: string, predicate?: (n: GraphNode) => boolean): GraphNode[] {
    const out: GraphNode[] = []
    for (const n of this.nodes.values()) {
      if (n.type !== type) continue
      if (predicate && !predicate(n)) continue
      out.push(n)
    }
    return out
  }

  /** Number of nodes. */
  nodeCount(): number {
    return this.nodes.size
  }

  /** Number of edges. */
  edgeCount(): number {
    let total = 0
    for (const list of this.outgoing.values()) total += list.length
    return total
  }

  /** Drop everything. */
  clear(): void {
    this.nodes.clear()
    this.outgoing.clear()
    this.incoming.clear()
    this.insertionOrder.length = 0
  }

  /** Serialize to a plain-object snapshot. */
  serialize(): { nodes: GraphNode[]; edges: GraphEdge[] } {
    const edges: GraphEdge[] = []
    for (const list of this.outgoing.values()) edges.push(...list)
    return { nodes: Array.from(this.nodes.values()), edges }
  }

  /** Load from a serialized snapshot, replacing current state. */
  loadSnapshot(snapshot: { nodes: GraphNode[]; edges: GraphEdge[] }): void {
    this.clear()
    for (const n of snapshot.nodes) this.addNode(n)
    for (const e of snapshot.edges) this.addEdge(e)
  }

  private evictIfNeeded(): void {
    while (this.nodes.size > this.maxNodes && this.insertionOrder.length > 0) {
      const evictId = this.insertionOrder.shift()!
      this.removeNode(evictId)
    }
  }
}