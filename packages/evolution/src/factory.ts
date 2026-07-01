/**
 * Evolution-aware agent factory.
 *
 * Wraps the existing defaultAgentFactory with two new behaviors:
 *   1. SELECT: pick the best (provider, model) for this role using history
 *   2. AUGMENT: inject the role's memory prelude into the system prompt
 *
 * Selection happens synchronously at construction time. Memory injection
 * happens in `receiveTask` (an existing hook the runtime already calls),
 * which keeps the contract with AgentRuntime intact.
 */

import { Agent, type AgentContext, type AgentRole, type Result, type Task } from "@max/core";
import { defaultAgentFactory } from "@max/agents";
import type { Provider } from "@max/providers";
import type { EvolutionFacade } from "./facade.js";
import { AgentMemoryStore } from "./memory.js";
import type { ModelSelection } from "./types.js";

export function evolutionAwareFactory(facade: EvolutionFacade): (role: AgentRole) => Agent | undefined {
  return (role) => {
    const selection = facade.selectForRole(role);
    const provider = resolveProvider(facade, selection.provider);
    const inner = defaultAgentFactory(() => provider)(role);
    if (!inner) return undefined;
    // Plumb evolution's per-role model choice into the agent's override
    // field so concrete agents (which read `getEffectiveModel()` and pass
    // it as ChatOptions.model) actually use the selected model. Without
    // this, the leaderboard-driven selection is dropped at the LLM call.
    inner.setModelOverride(selection.provider, selection.model);

    return new MemoryAugmentedAgent(inner, facade, selection);
  };
}

class MemoryAugmentedAgent extends Agent {
  private selection: ModelSelection;
  constructor(
    private readonly inner: Agent,
    private readonly facade: EvolutionFacade,
    selection: ModelSelection
  ) {
    super(inner["provider"] as Provider, inner.id);
    this.selection = selection;
  }

  get manifest() {
    return {
      ...this.inner.manifest,
      modelProviderId: this.selection.provider,
      modelName: this.selection.model,
    };
  }

  override async receiveTask(task: Task, _ctx: AgentContext): Promise<void> {
    const profile = await this.facade.activeProfile(task.agentRole);
    const prelude = AgentMemoryStore.toPrelude(profile.memory);
    if (prelude) {
      const augmented = {
        ...this.inner.manifest,
        systemPrompt: this.inner.manifest.systemPrompt + prelude,
      };
      (this.inner as { manifest: typeof augmented }).manifest = augmented;
    }
  }

  override async execute(task: Task, ctx: AgentContext): Promise<Result> {
    return this.inner.execute(task, ctx);
  }

  override async submitResult(result: Result): Promise<Result> {
    return this.inner.submitResult(result);
  }
}

function resolveProvider(facade: EvolutionFacade, id: string): Provider {
  const candidates = (facade as unknown as { opts: { candidates: Provider[] } }).opts.candidates;
  return candidates.find((p) => p.id === id) ?? candidates[0]!;
}
