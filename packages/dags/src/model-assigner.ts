/**
 * Stage 5 — Model Assignment.
 *
 * Uses EvolutionFacade to pick (provider, model) for each team node.
 * Persists the assignment back into the graph and the blueprint.
 *
 * No hardcoded model. Selection is driven entirely by historical metrics.
 */

import type { EvolutionFacade } from "@max/evolution";
import type { AgentBlueprint, TeamGraph, TeamNode } from "./types.js";
import { BlueprintStore } from "./blueprint-store.js";
import type { Provider } from "@max/providers";

export class ModelAssigner {
  constructor(
    private facade: EvolutionFacade,
    private store: BlueprintStore
  ) {}

  /**
   * Mutates the graph in place by filling `modelAssignment` on each node.
   * Returns the updated graph.
   */
  async assign(graph: TeamGraph): Promise<TeamGraph> {
    for (const node of graph.nodes) {
      const selection = this.facade.selectForRole(node.role as Parameters<typeof this.facade.selectForRole>[0]);
      node.modelAssignment = {
        provider: selection.provider,
        model: selection.model,
        reason: selection.reason,
        score: selection.score,
      };
    }
    await this.store.saveGraph({ ...graph, status: "ready" });
    return graph;
  }

  /**
   * Resolve a (provider, model) pair from a node's assignment to a concrete
   * Provider instance. Throws if the provider is not registered.
   */
  resolveProvider(node: TeamNode, candidates: Provider[]): { provider: Provider; model: string } {
    if (!node.modelAssignment) {
      throw new Error(`Node ${node.id} has no model assignment`);
    }
    const provider = candidates.find((p) => p.id === node.modelAssignment!.provider);
    if (!provider) {
      throw new Error(`Provider ${node.modelAssignment.provider} not in candidate list`);
    }
    return { provider, model: node.modelAssignment.model };
  }

  /**
   * Convenience: return assignments grouped by blueprint for the
   * DynamicAgentFactory.
   */
  buildAgentContexts(
    graph: TeamGraph,
    candidates: Provider[],
    blueprints: AgentBlueprint[]
  ): Array<{ node: TeamNode; blueprint: AgentBlueprint; provider: Provider; model: string }> {
    const byBlueprintId = new Map(blueprints.map((b) => [b.id, b]));
    return graph.nodes.map((node) => {
      const blueprint = byBlueprintId.get(node.blueprintId);
      if (!blueprint) throw new Error(`Blueprint ${node.blueprintId} not found`);
      const { provider, model } = this.resolveProvider(node, candidates);
      return { node, blueprint, provider, model };
    });
  }
}
