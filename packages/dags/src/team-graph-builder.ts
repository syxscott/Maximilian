/**
 * Stage 4 — Team Graph Builder.
 *
 * Inputs:  AgentBlueprint[] + the original capability list
 * Outputs: TeamGraph (DAG) with nodes, edges, layers.
 *
 * Algorithm:
 *   1. Create one node per blueprint.
 *   2. For each node, compute dependsOn:
 *      - other nodes whose capabilities this blueprint depends on
 *      - if this node is a reviewer, all non-reviewer nodes
 *   3. Build edges: data_flow + review.
 *   4. Topological sort (Kahn's algorithm).
 *   5. Detect cycles; if any, throw.
 *   6. Compute parallel layers.
 */

import { randomUUID } from "node:crypto";
import type {
  AgentBlueprint,
  TeamEdge,
  TeamGraph,
  TeamLayer,
  TeamNode,
} from "./types.js";

export class TeamGraphBuilder {
  build(blueprints: AgentBlueprint[], userRequest: string, capabilities: string[]): TeamGraph {
    if (blueprints.length === 0) {
      throw new Error("Cannot build team graph from zero blueprints");
    }

    // Step 1: nodes.
    const nodes: TeamNode[] = blueprints.map((bp) => ({
      id: `node-${bp.id}`,
      blueprintId: bp.id,
      role: bp.role,
      displayName: bp.displayName,
      dependsOn: [],
    }));

    const byNodeId = new Map(nodes.map((n) => [n.id, n]));
    const byRole = new Map(nodes.map((n) => [n.role, n]));
    const byBlueprintId = new Map(blueprints.map((b) => [b.id, b]));

    // Step 2: dependsOn.
    const edges: TeamEdge[] = [];
    for (const node of nodes) {
      const bp = byBlueprintId.get(node.blueprintId)!;

      // 2a. Capability dependencies: for each capability the blueprint
      // covers, find any other node that is the "source" of that
      // capability's dependsOn relationship.
      for (const capId of bp.capabilities) {
        // We treat category-level peers as implicit dependencies:
        // if any blueprint's role is a known producer for a downstream
        // category, the downstream depends on the producer.
        // The capability library declares these (e.g. "frontend" depends
        // on "backend"). We resolve them via the node's role.
        const producerRoles = producerFor(node.role);
        for (const producer of producerRoles) {
          const producerNode = byRole.get(producer);
          if (producerNode && producerNode.id !== node.id && !node.dependsOn.includes(producerNode.id)) {
            node.dependsOn.push(producerNode.id);
            edges.push({
              from: producerNode.id,
              to: node.id,
              type: "data_flow",
              description: `${producerNode.displayName} → ${node.displayName}`,
            });
          }
        }
      }

      // 2b. Reviewer depends on all non-reviewer nodes.
      if (bp.capabilities.includes("review")) {
        for (const other of nodes) {
          if (other.id === node.id) continue;
          const otherBp = byBlueprintId.get(other.blueprintId)!;
          if (otherBp.capabilities.includes("review")) continue;
          if (!node.dependsOn.includes(other.id)) {
            node.dependsOn.push(other.id);
            edges.push({
              from: other.id,
              to: node.id,
              type: "review",
              description: `${other.displayName} → ${node.displayName} (review)`,
            });
          }
        }
      }
    }

    // Step 3: validate.
    for (const n of nodes) {
      if (!byNodeId.has(n.id)) throw new Error(`Node ${n.id} references unknown node`);
    }

    // Step 4: topological sort with cycle detection.
    const layers = topoLayers(nodes);
    const visited = new Set(layers.flatMap((l) => l.nodeIds));
    const stuck = nodes.filter((n) => !visited.has(n.id));
    if (stuck.length > 0) {
      throw new Error(`Cycle detected in team graph; stuck nodes: ${stuck.map((s) => s.role).join(", ")}`);
    }

    return {
      id: `team-${randomUUID().slice(0, 8)}`,
      userRequest,
      capabilities,
      nodes,
      edges,
      layers,
      createdAt: new Date().toISOString(),
      status: "ready",
    };
  }
}

/**
 * Returns the roles whose output the given role depends on.
 * Mirrors the capability-library dependsOn graph at the role level.
 */
function producerFor(role: string): string[] {
  switch (role) {
    case "frontend":        return ["backend", "product_designer"];
    case "data_engineer":   return ["product_designer"];
    case "devops":          return ["backend"];
    case "tester":          return ["backend", "frontend"];
    case "writer":          return ["backend", "frontend"];
    case "reviewer":        return []; // reviewer depends on all (handled separately)
    case "researcher":      return [];
    case "product_designer":return [];
    case "backend":         return ["product_designer"];
    default:                return [];
  }
}

function topoLayers(nodes: TeamNode[]): TeamLayer[] {
  const indeg = new Map<string, number>();
  const out = new Map<string, string[]>();
  for (const n of nodes) {
    indeg.set(n.id, n.dependsOn.length);
    out.set(n.id, []);
  }
  for (const n of nodes) {
    for (const dep of n.dependsOn) {
      const arr = out.get(dep) ?? [];
      arr.push(n.id);
      out.set(dep, arr);
    }
  }
  const layers: TeamLayer[] = [];
  let frontier = nodes.filter((n) => indeg.get(n.id) === 0).map((n) => n.id);
  let idx = 0;
  const visited = new Set<string>();
  while (frontier.length > 0) {
    layers.push({ index: idx++, nodeIds: [...frontier] });
    const next: string[] = [];
    for (const id of frontier) {
      visited.add(id);
      for (const child of out.get(id) ?? []) {
        const d = (indeg.get(child) ?? 0) - 1;
        indeg.set(child, d);
        if (d === 0) next.push(child);
      }
    }
    frontier = next;
  }
  if (visited.size !== nodes.length) {
    // Cycle. Return partial layers; caller detects and throws.
    return layers;
  }
  return layers;
}
