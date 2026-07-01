/**
 * Stage 3 — Dynamic Agent Factory.
 *
 * Materializes a runtime Agent from a persisted AgentBlueprint.
 *
 * The returned agent:
 *   - uses the blueprint's systemPrompt (with memory prelude already injected)
 *   - uses the assigned (provider, model)
 *   - on execute, captures token usage + timing, which is reported back to
 *     the BlueprintStore to update stats.
 */

import { randomUUID } from "node:crypto";
import {
  Agent,
  type AgentContext,
  type AgentManifest,
  type Result,
  type Task,
} from "@max/core";
import type { ChatMessage, ChatOptions, Provider } from "@max/providers";
import type { AgentBlueprint, ModelHint } from "./types.js";
import { BlueprintStore } from "./blueprint-store.js";
import { getLogger } from "@max/telemetry";

const log = getLogger("dags:factory");

export interface AgentCreationContext {
  blueprint: AgentBlueprint;
  provider: Provider;
  model: string;
  memoryPrelude: string;
  store: BlueprintStore;
}

export class DynamicAgentFactory {
  constructor(private store: BlueprintStore) {}

  /**
   * Build an Agent instance from a blueprint. The returned object is a
   * fresh subclass instance — one per (blueprint, task) — so memory and
   * short-term state don't leak between calls.
   */
  create(ctx: AgentCreationContext): Agent {
    return new BlueprintAgent(ctx);
  }
}

class BlueprintAgent extends Agent {
  private readonly blueprint: AgentBlueprint;
  private readonly assignedModel: string;
  private readonly assignedProvider: Provider;
  private readonly store: BlueprintStore;
  private readonly blueprintSnapshot: AgentBlueprint;
  /** Static prelude baked into the blueprint at design time. */
  private readonly blueprintPrelude: string;
  private readonly start = Date.now();

  constructor(ctx: AgentCreationContext) {
    super(ctx.provider, `dyn-${randomUUID().slice(0, 6)}`);
    this.blueprint = ctx.blueprint;
    this.assignedModel = ctx.model;
    this.assignedProvider = ctx.provider;
    this.blueprintPrelude = ctx.memoryPrelude;
    this.store = ctx.store;
    this.blueprintSnapshot = ctx.blueprint;
  }

  override get manifest(): AgentManifest {
    return {
      role: this.blueprint.role as AgentManifest["role"],
      displayName: this.blueprint.displayName,
      goal: this.blueprint.goal,
      // Static blueprint prompt only — runtime-injected memory is merged
      // into the system message inside `execute()` so it stays separate.
      systemPrompt: this.blueprint.systemPrompt,
      modelProviderId: this.assignedProvider.id,
      modelName: this.assignedModel,
    };
  }

  override async execute(task: Task, _ctx: AgentContext): Promise<Result> {
    const options: ChatOptions = {
      model: this.assignedModel,
      temperature: this.blueprint.constraints.temperature,
      maxTokens: this.blueprint.constraints.maxTokens,
    };
    if (this.blueprint.constraints.outputFormat === "json") {
      options.jsonMode = true;
    }

    // Combine: static blueprint prelude + runtime-injected memory prelude.
    // The runtime sets `this.memoryPrelude` via `setMemoryPrelude()` from
    // the AgentMemoryStorePort; keeping it in a separate field avoids the
    // runtime call clobbering the blueprint's baked-in prelude.
    const preludeParts = [this.blueprintPrelude, this.memoryPrelude].filter((p) => p.length > 0);
    const systemContent = preludeParts.length > 0
      ? `${this.blueprint.systemPrompt}\n${preludeParts.join("\n")}`
      : this.blueprint.systemPrompt;

    const messages: ChatMessage[] = [
      { role: "system", content: systemContent },
      ...this.memory,
      { role: "user", content: task.description },
    ];

    const response = await this.assignedProvider.chat(messages, options);
    const durationMs = Date.now() - this.start;

    // Best-effort: persist updated stats (non-blocking relative to the
    // caller's await).
    void this.persistStats(durationMs, response.usage);

    return {
      id: randomUUID(),
      taskId: task.id,
      agentRole: this.blueprint.role as Result["agentRole"],
      agentId: this.id,
      output: response.content,
      metadata: {
        model: response.model,
        usage: response.usage,
        blueprintId: this.blueprint.id,
        blueprintVersion: this.blueprint.version,
        provider: this.assignedProvider.id,
        durationMs,
      },
      createdAt: new Date().toISOString(),
      durationMs,
    };
  }

  private async persistStats(
    durationMs: number,
    usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | undefined
  ): Promise<void> {
    try {
      const current = await this.store.get(this.blueprintSnapshot.id);
      if (!current) return;
      const total = current.stats.totalTasks + 1;
      const avg = (current.stats.avgExecutionTimeMs * current.stats.totalTasks + durationMs) / total;
      const updated: AgentBlueprint = {
        ...current,
        stats: {
          ...current.stats,
          totalTasks: total,
          avgExecutionTimeMs: avg,
          lastUsedAt: new Date().toISOString(),
        },
        updatedAt: new Date().toISOString(),
        metadata: {
          ...current.metadata,
          lastUsage: {
            promptTokens: usage?.promptTokens ?? 0,
            completionTokens: usage?.completionTokens ?? 0,
            totalTokens: usage?.totalTokens ?? 0,
            at: new Date().toISOString(),
          },
        },
      };
      await this.store.save(updated);
    } catch (err) {
      // Stats are best-effort; never fail the user-visible task on this.
      log.warn({ err }, "failed to persist blueprint stats");
    }
  }
}

export { ModelHint };
