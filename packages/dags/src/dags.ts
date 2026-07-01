/**
 * DAGS — high-level orchestrator.
 *
 * `DAGS.compose(userRequest)` runs the full pipeline:
 *   1. CapabilityAnalyzer
 *   2. BlueprintGenerator (+ BlueprintStore)
 *   3. (factory created on demand)
 *   4. TeamGraphBuilder
 *   5. ModelAssigner (uses EvolutionFacade)
 *
 * Returns a fully-bound team ready to be turned into Agent instances
 * via DynamicAgentFactory.
 */

import type { Provider } from "@max/providers";
import { getLogger } from "@max/telemetry";

const log = getLogger("dags");
import type { EvolutionFacade } from "@max/evolution";
import type { AgentBlueprint, TeamGraph } from "./types.js";
import { CapabilityLibrary } from "./capability-library.js";
import { CapabilityAnalyzer } from "./capability-analyzer.js";
import { BlueprintStore, newTeamId } from "./blueprint-store.js";
import { BlueprintGenerator } from "./blueprint-generator.js";
import { TeamGraphBuilder } from "./team-graph-builder.js";
import { ModelAssigner } from "./model-assigner.js";
import { DynamicAgentFactory, type AgentCreationContext } from "./dynamic-agent-factory.js";

export interface ComposedTeam {
  graph: TeamGraph;
  blueprints: AgentBlueprint[];
  contexts: Array<AgentCreationContext & { role: string }>;
  capabilities: string[];
}

export interface DAGSOptions {
  rootDir: string;
  evolution: EvolutionFacade;
  candidates: Provider[];
  /** Optional custom capability library. */
  library?: CapabilityLibrary;
  /** Optional shared BlueprintStore (so meta-system can write into the same store). */
  store?: BlueprintStore;
  /** Force include these capabilities. */
  alwaysInclude?: string[];
  /**
   * Phase 7 — Optional sync hook. Called before every compose() to
   * inject capabilities derived from the meta-system's CapabilityRegistry.
   * Returned capabilities replace any previously-injected dynamic set.
   */
  syncDynamicCapabilities?: () => Promise<import("./types.js").Capability[]>;
}

export class DAGS {
  readonly library: CapabilityLibrary;
  readonly analyzer: CapabilityAnalyzer;
  readonly store: BlueprintStore;
  readonly generator: BlueprintGenerator;
  readonly graphBuilder: TeamGraphBuilder;
  readonly assigner: ModelAssigner;
  readonly agentFactory: DynamicAgentFactory;

  constructor(private opts: DAGSOptions) {
    this.library = opts.library ?? new CapabilityLibrary();
    this.analyzer = new CapabilityAnalyzer(this.library, {
      alwaysInclude: opts.alwaysInclude,
    });
    this.store = opts.store ?? new BlueprintStore(opts.rootDir);
    this.generator = new BlueprintGenerator(this.library, this.store);
    this.graphBuilder = new TeamGraphBuilder();
    this.assigner = new ModelAssigner(opts.evolution, this.store);
    this.agentFactory = new DynamicAgentFactory(this.store);
  }

  /**
   * Full pipeline: analyze → generate → build graph → assign models.
   */
  async compose(userRequest: string): Promise<ComposedTeam> {
    // Phase 7 — Sync dynamic capabilities from CapabilityRegistry (if wired)
    // so newly-active capabilities participate without restart.
    if (this.opts.syncDynamicCapabilities) {
      try {
        const dynamic = await this.opts.syncDynamicCapabilities();
        this.library.replaceDynamic(dynamic);
      } catch (err) {
        // Sync failure should not break compose — log and continue with stale library.
        log.warn({ err }, "dynamic capability sync failed");
      }
    }

    const capabilities = this.analyzer.analyze(userRequest);
    const blueprints = await this.generator.generate(capabilities, {
      reuseExisting: true,
      userRequest,
    });
    const graph = this.graphBuilder.build(blueprints, userRequest, capabilities);
    await this.assigner.assign(graph);

    const contexts = this.assigner.buildAgentContexts(
      graph,
      this.opts.candidates,
      blueprints
    );

    // Attach memory prelude per node (the dynamic agent reads it).
    const enriched = await Promise.all(
      contexts.map(async (ctx) => {
        // Evolution profiles use the strict AgentRole enum; map our
        // dynamic role to the closest valid bucket. The blueprint's
        // own role is preserved on the Agent context.
        const evolutionRole = mapToEvolutionRole(ctx.blueprint.role);
        const profile = await this.opts.evolution.activeProfile(evolutionRole);
        const { AgentMemoryStore } = await import("@max/evolution");
        const prelude = AgentMemoryStore.toPrelude(profile.memory);
        return {
          blueprint: ctx.blueprint,
          provider: ctx.provider,
          model: ctx.model,
          memoryPrelude: prelude,
          store: this.store,
          role: ctx.node.role,
        };
      })
    );

    return { graph, blueprints, contexts: enriched, capabilities };
  }

  /**
   * Stepwise: persist a composed team and return a factory function
   * suitable for AgentRuntime's AgentFactory signature.
   *
   * This wraps the dynamic agent so the runtime sees an ordinary
   * factory: (role: AgentRole) => Agent | undefined
   */
  buildAgentFactory(composed: ComposedTeam): (role: string) => import("@max/core").Agent | undefined {
    const map = new Map<string, { ctx: typeof composed.contexts[number] }>();
    for (const ctx of composed.contexts) {
      map.set(ctx.role, { ctx });
    }
    return (role: string) => {
      const entry = map.get(role);
      if (!entry) return undefined;
      return this.agentFactory.create(entry.ctx);
    };
  }

  /** Save an existing graph (used by the API for re-persistence). */
  async saveGraph(graph: TeamGraph): Promise<void> {
    await this.store.saveGraph({ ...graph, id: graph.id || newTeamId() });
  }
}

/**
 * Map a dynamic DAGS role (which is an open string) to a valid
 * AgentRole enum value for the Evolution engine's profile system.
 * Falls back to "general" for unknown roles.
 */
function mapToEvolutionRole(role: string): import("@max/core").AgentRole {
  switch (role) {
    case "frontend":     return "frontend";
    case "backend":      return "backend";
    case "reviewer":     return "review";
    default:             return "general";
  }
}
