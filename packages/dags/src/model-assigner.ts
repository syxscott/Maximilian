/**
 * Stage 5 — Model Assignment.
 *
 * Uses EvolutionFacade to pick (provider, model) for each team node.
 * Persists the assignment back into the graph and the blueprint.
 *
 * No hardcoded model. Selection is driven entirely by historical metrics,
 * annotated with a **role tier**. The frontier/standard/economy vocabulary
 * is inspired by wshobson/agents' per-agent model tiers but is a
 * Maximilian invention (upstream tiers map to concrete models at agent
 * generation time; here tier is currently ANNOTATION-ONLY — the selector
 * does not read it yet). The tier is recorded on every node so a future
 * tier-enforcing selector can key on it, and so the leaderboard can later
 * answer "does the review role actually need a frontier model?".
 */

import type { EvolutionFacade } from "@max/evolution"
import type { AgentBlueprint, TeamGraph, TeamNode } from "./types.js"
import { BlueprintStore } from "./blueprint-store.js"
import type { Provider } from "@max/providers"

export type RoleTier = "frontier" | "standard" | "economy"

/**
 * Role → tier policy. Matching is substring-based so DAGS-generated role
 * slugs ("reviewer-2", "orchestrator") hit the same rule as their base
 * role. Unmatched roles default to "standard".
 */
export type RoleTierPolicy = (role: string) => RoleTier

export const DEFAULT_ROLE_TIER_POLICY: RoleTierPolicy = (role) => {
  const r = role.toLowerCase()
  if (/review|orchestr|command|architect|audit/.test(r)) return "frontier"
  if (/doc|summar|utility|formatter|linter|checklist/.test(r)) return "economy"
  return "standard"
}

export class ModelAssigner {
  private tierPolicy: RoleTierPolicy

  constructor(
    private facade: EvolutionFacade,
    private store: BlueprintStore,
    tierPolicy?: RoleTierPolicy,
  ) {
    this.tierPolicy = tierPolicy ?? DEFAULT_ROLE_TIER_POLICY
  }

  /**
   * Mutates the graph in place by filling `modelAssignment` on each node.
   * Returns the updated graph.
   */
  async assign(graph: TeamGraph): Promise<TeamGraph> {
    for (const node of graph.nodes) {
      if (node.kind === "approval") continue
      const selection = this.facade.selectForRole(
        node.role as Parameters<typeof this.facade.selectForRole>[0],
      )
      const tier = this.tierPolicy(node.role)
      node.modelAssignment = {
        provider: selection.provider,
        model: selection.model,
        reason: `${selection.reason} [tier=${tier}]`,
        score: selection.score,
        tier,
      }
    }
    await this.store.saveGraph({ ...graph, status: "ready" })
    return graph
  }

  /**
   * Resolve a (provider, model) pair from a node's assignment to a concrete
   * Provider instance. Throws if the provider is not registered.
   */
  resolveProvider(node: TeamNode, candidates: Provider[]): { provider: Provider; model: string } {
    if (!node.modelAssignment) {
      throw new Error(`Node ${node.id} has no model assignment`)
    }
    const provider = candidates.find((p) => p.id === node.modelAssignment!.provider)
    if (!provider) {
      throw new Error(`Provider ${node.modelAssignment.provider} not in candidate list`)
    }
    return { provider, model: node.modelAssignment.model }
  }

  /**
   * Convenience: return assignments grouped by blueprint for the
   * DynamicAgentFactory.
   */
  buildAgentContexts(
    graph: TeamGraph,
    candidates: Provider[],
    blueprints: AgentBlueprint[],
  ): Array<{ node: TeamNode; blueprint: AgentBlueprint; provider: Provider; model: string }> {
    const byBlueprintId = new Map(blueprints.map((b) => [b.id, b]))
    return graph.nodes.flatMap((node) => {
      if (node.kind === "approval") return []
      const blueprint = node.blueprintId ? byBlueprintId.get(node.blueprintId) : undefined
      if (!blueprint) throw new Error(`Blueprint ${node.blueprintId} not found`)
      const { provider, model } = this.resolveProvider(node, candidates)
      return [{ node, blueprint, provider, model }]
    })
  }
}
