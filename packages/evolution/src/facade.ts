/**
 * High-level facade that composes the six evolution modules.
 *
 * This is what the runtime and API layer use. It hides the wiring:
 *   - one MetricsStore / ProfileStore / Leaderboard
 *   - one ModelSelector  that consumes the leaderboard
 *   - one EvolutionEngine that consults the metrics + profile
 *
 * It also exposes two operations the runtime needs without modifying it:
 *   - recordCompletion(...)   hook called after a task completes
 *   - selectForRole(role)     called by the agent factory wrapper
 */

import type { AgentRole, AgentManifest, Result, Task, Workspace } from "@max/core";
import type { Provider } from "@max/providers";
import { MetricsStore } from "./metrics-store.js";
import { ProfileStore } from "./profile-store.js";
import { Leaderboard } from "./leaderboard.js";
import { ModelSelector } from "./selector.js";
import { AgentMemoryStore } from "./memory.js";
import { EvolutionEngine } from "./evolution.js";
import type { AgentProfile, MetricRecord, ModelSelection } from "./types.js";

export interface CompletionInput {
  task: Task;
  result?: Result;
  error?: string;
  provider: string;
  model: string;
  executionTimeMs: number;
  tokenInput: number;
  tokenOutput: number;
  /** Tokens served from provider-side prompt cache. 0 if not reported. */
  cacheReadTokens?: number;
  /** Tokens written into provider-side cache. 0 for OpenAI-style protocols. */
  cacheCreationTokens?: number;
  reviewScore?: number;
  userAccepted?: boolean;
  defaultManifest: AgentManifest;
}

export interface EvolutionFacadeOptions {
  rootDir: string;
  candidates: Provider[];
  fallbackProvider: Provider;
  defaultManifests: Partial<Record<AgentRole, AgentManifest>>;
  /** Optional database-backed stores. When provided, overrides file-based defaults. */
  profileStore?: ProfileStore;
  metricsStore?: MetricsStore;
}

export class EvolutionFacade {
  readonly metrics: MetricsStore;
  readonly profiles: ProfileStore;
  readonly leaderboard: Leaderboard;
  readonly selector: ModelSelector;
  readonly evolution: EvolutionEngine;

  constructor(private opts: EvolutionFacadeOptions) {
    this.metrics = opts.metricsStore ?? new MetricsStore(opts.rootDir);
    this.profiles = opts.profileStore ?? new ProfileStore(opts.rootDir);
    this.leaderboard = new Leaderboard();
    this.selector = new ModelSelector(undefined, opts.candidates.map((p) => ({ provider: p })));
    this.evolution = new EvolutionEngine(opts.rootDir, this.metrics, this.profiles);
  }

  async initialize(): Promise<void> {
    await this.leaderboard.rebuild(this.metrics);
  }

  /**
   * Hook called by the runtime after every task (success or failure).
   * Persists a metric, recomputes the leaderboard, and updates the profile.
   */
  async recordCompletion(input: CompletionInput): Promise<MetricRecord> {
    const record: MetricRecord = {
      taskId: input.task.id,
      agentId: input.result?.agentId ?? "unknown",
      agentRole: input.task.agentRole,
      provider: input.provider,
      model: input.model,
      executionTime: input.executionTimeMs,
      tokenInput: input.tokenInput,
      tokenOutput: input.tokenOutput,
      cacheReadTokens: input.cacheReadTokens ?? 0,
      cacheCreationTokens: input.cacheCreationTokens ?? 0,
      reviewScore: input.reviewScore,
      userAccepted: input.userAccepted,
      retryCount: 0,
      error: input.error,
      timestamp: new Date().toISOString(),
    };
    await this.metrics.record(record);

    const profile = await this.profiles.getOrCreate(input.task.agentRole, input.defaultManifest);
    const records = await this.metrics.listForRole(input.task.agentRole);
    const updated = ProfileStore.recompute(profile, records);

    let nextMemory = updated.memory;
    if (input.error || (input.reviewScore !== undefined && input.reviewScore < 6)) {
      nextMemory = AgentMemoryStore.recordFailure(nextMemory, record);
    } else if (input.result) {
      nextMemory = AgentMemoryStore.recordSuccess(nextMemory, record, input.result.output.slice(0, 240));
    }
    if (input.reviewScore !== undefined && input.result?.metadata?.review) {
      const suggestions = (input.result.metadata.review as { suggestions?: string[] }).suggestions ?? [];
      nextMemory = AgentMemoryStore.recordReviewSuggestions(nextMemory, suggestions);
    }
    nextMemory = await AgentMemoryStore.maybeCompress(nextMemory);
    await this.profiles.save({ ...updated, memory: nextMemory });

    await this.leaderboard.rebuild(this.metrics);
    return record;
  }

  /**
   * Used by the agent factory wrapper to pick (provider, model) for a role.
   */
  selectForRole(role: AgentRole): ModelSelection {
    return this.selector.select(role, this.leaderboard, { provider: this.opts.fallbackProvider });
  }

  /**
   * Used by the agent factory wrapper to load the role's active profile
   * (so the manifest's systemPrompt includes the memory prelude).
   */
  async activeProfile(role: AgentRole): Promise<AgentProfile> {
    const fallback = this.opts.defaultManifests[role] ?? {
      role,
      displayName: role,
      goal: role,
      systemPrompt: `You are the ${role} agent.`,
    };
    return this.profiles.getOrCreate(role, fallback);
  }

  /**
   * Optional post-run trigger. If a profile is under-performing and has
   * enough history, run the evolution cycle.
   */
  async maybeEvolve(role: AgentRole): Promise<import("./types.js").EvolutionDecision | undefined> {
    const profile = await this.profiles.get(role);
    if (!profile) return undefined;
    const recent = (await this.metrics.listForRole(role)).slice(-20);
    if (!EvolutionEngine.shouldEvolve(profile, recent)) return undefined;
    if (!profile.manifest) return undefined;
    return this.evolution.evolve(role, profile.manifest);
  }

  /**
   * Convenience: when a workspace is fully complete (all tasks done),
   * walk the per-task metrics and persist any review scores that
   * weren't known at the time the worker task completed.
   */
  async attachReviewScores(workspace: Workspace): Promise<void> {
    const review = workspace.review;
    if (!review) return;
    for (const result of workspace.results) {
      if (result.agentRole === "review") continue;
      const existing = await this.metrics.get(result.taskId);
      if (existing && existing.reviewScore === undefined) {
        await this.metrics.record({ ...existing, reviewScore: review.score });
      }
    }
    await this.leaderboard.rebuild(this.metrics);
  }
}
