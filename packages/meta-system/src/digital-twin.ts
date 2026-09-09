/**
 * Phase 8.2 — Digital Twin (OrganizationSnapshot).
 *
 * A read-only in-memory snapshot of the organization at a moment in time.
 * All mutation proposals are applied to a cloned twin, never to the live
 * state. The orchestrator then compares simulate(twin) vs simulate(live)
 * to decide whether to apply the change.
 *
 * Captures: capabilities, blueprints, team graphs, leaderboards.
 */

import { randomUUID } from "node:crypto";
import {
  OrganizationSnapshotSchema,
  type OrganizationSnapshot,
  type CapabilityRecord,
} from "./types.js";
import type { AgentBlueprint, TeamGraph } from "@max/dags";
import type { OpencodeExecutor, ExecuteResult } from "@max/core";

export interface CaptureInput {
  capabilities: CapabilityRecord[];
  blueprints: AgentBlueprint[];
  graphs: TeamGraph[];
  leaderboards?: Record<string, unknown>;
}

export interface TwinProposal {
  /** What kind of change to apply to the twin. */
  kind:
    | "birth"
    | "retire"
    | "promote"
    | "demote"
    | "merge"
    | "split"
    | "rebalance_team";
  /** Subject of the change (capability id or blueprint id or role). */
  subject: string;
  /** Optional target (e.g. merge target role, split target role). */
  target?: string;
}

export class DigitalTwin {
  /** Capture a snapshot of the current organization state. */
  static capture(input: CaptureInput): OrganizationSnapshot {
    const raw = {
      id: `snap-${randomUUID().slice(0, 8)}`,
      capturedAt: new Date().toISOString(),
      capabilities: input.capabilities,
      blueprints: input.blueprints as unknown as Record<string, unknown>[],
      graphs: input.graphs as unknown as Record<string, unknown>[],
      leaderboards: input.leaderboards ?? {},
    };
    // Deep clone to prevent shared references between snapshot and live state.
    return OrganizationSnapshotSchema.parse(structuredClone(raw));
  }

  /**
   * Apply a proposal to a cloned twin. Returns a NEW snapshot.
   * The original snapshot is never mutated.
   */
  static apply(snap: OrganizationSnapshot, proposal: TwinProposal): OrganizationSnapshot {
    const cloned: OrganizationSnapshot = {
      ...snap,
      capabilities: snap.capabilities.map((c) => ({ ...c })),
      blueprints: snap.blueprints.map((b) => ({ ...b })),
      graphs: snap.graphs.map((g) => ({ ...g })),
      leaderboards: { ...snap.leaderboards },
    };

    switch (proposal.kind) {
      case "birth": {
        cloned.capabilities.push({
          id: proposal.subject,
          displayName: proposal.subject,
          description: "",
          status: "active",
          promotedAt: new Date().toISOString(),
          usageCount: 0,
          totalExecutions: 0,
          avgScore: 0,
          avgDurationMs: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        cloned.blueprints.push({
          id: `bp-${proposal.subject}-twin`,
          role: `${proposal.subject}_agent`,
        } as unknown as typeof cloned.blueprints[number]);
        break;
      }
      case "retire": {
        for (const c of cloned.capabilities) {
          if ((c.id === proposal.subject || c.id + "_agent" === proposal.subject) && c.status !== "retired") {
            c.status = "retired";
            c.retiredAt = new Date().toISOString();
            c.updatedAt = c.retiredAt;
          }
        }
        for (const b of cloned.blueprints) {
          const bb = b as unknown as { id?: string; role?: string; retiredAt?: string };
          if (bb.id === proposal.subject || bb.role === proposal.subject) {
            bb.retiredAt = new Date().toISOString();
          }
        }
        break;
      }
      case "promote": {
        for (const c of cloned.capabilities) {
          if (c.id === proposal.subject && c.status !== "retired") {
            c.status = "active";
            c.promotedAt = new Date().toISOString();
            c.updatedAt = c.promotedAt;
          }
        }
        break;
      }
      case "demote": {
        for (const c of cloned.capabilities) {
          if (c.id === proposal.subject && c.status !== "retired") {
            c.status = "deprecated";
            c.updatedAt = new Date().toISOString();
          }
        }
        break;
      }
      case "merge": {
        // Subject role gets retired; target role keeps going.
        for (const b of cloned.blueprints) {
          const bb = b as unknown as { id?: string; role?: string; retiredAt?: string };
          if (bb.role === proposal.subject) {
            bb.retiredAt = new Date().toISOString();
          }
        }
        break;
      }
      case "split": {
        // Source role retires; a new role appears (proposal.target).
        for (const b of cloned.blueprints) {
          const bb = b as unknown as { id?: string; role?: string; retiredAt?: string };
          if (bb.role === proposal.subject) {
            bb.retiredAt = new Date().toISOString();
          }
        }
        cloned.blueprints.push({
          id: `bp-${proposal.target}-twin`,
          role: proposal.target ?? `${proposal.subject}_planner`,
        } as unknown as typeof cloned.blueprints[number]);
        break;
      }
      case "rebalance_team": {
        // No structural change; tracked via hint metadata in real flow.
        break;
      }
    }
    return cloned;
  }
}

/**
 * Build a SimulationInput from an OrganizationSnapshot, using each
 * blueprint's role as the node and a default profile.
 */
export function snapshotToSimulationInput(
  snap: OrganizationSnapshot,
  orgName: string
): {
  orgName: string;
  graph: TeamGraph;
  profiles: Record<string, { costPerCall: number; latencyMs: number; qualityScore: number }>;
} {
  const nodes = snap.blueprints.map((b, i) => {
    const bb = b as unknown as {
      id?: string;
      role?: string;
      displayName?: string;
      retiredAt?: string;
    };
    return {
      kind: "agent" as const,
      id: bb.id ?? `n-${i}`,
      blueprintId: bb.id ?? `bp-${i}`,
      role: bb.role ?? "unknown",
      displayName: bb.displayName ?? bb.role ?? "unknown",
      dependsOn: [] as string[],
      ...(bb.retiredAt ? { retiredAt: bb.retiredAt } : {}),
    };
  }).filter((n) => {
    const orig = snap.blueprints.find(
      (b) => (b as unknown as { id?: string }).id === n.blueprintId
    );
    return !(orig as unknown as { retiredAt?: string } | undefined)?.retiredAt;
  });

  const profiles: Record<string, { costPerCall: number; latencyMs: number; qualityScore: number }> = {};
  for (const node of nodes) {
    profiles[node.role] = profiles[node.role] ?? {
      costPerCall: 1,
      latencyMs: 1000,
      qualityScore: 7,
    };
  }

  return {
    orgName,
    graph: {
      id: `g-${snap.id}`,
      userRequest: `twin:${snap.id}`,
      capabilities: snap.capabilities.filter((c) => c.status === "active").map((c) => c.id),
      nodes: nodes.map(({ retiredAt: _r, ...rest }) => rest),
      edges: [],
      layers: [],
      createdAt: snap.capturedAt,
      status: "draft",
    },
    profiles,
  };
}

// ============================================================================
// Phase 3a — OpencodeDigitalTwin
//
// A "what if" simulator for adding a new agent / running a new scenario
// through opencode before committing. Unlike the static `DigitalTwin`
// above (which clones an `OrganizationSnapshot` and applies proposals),
// `OpencodeDigitalTwin` runs a *simulated* opencode session through an
// `OpencodeExecutor` and returns a predicted outcome (success / failure
// + estimated token cost).
//
// The executor is injected (with a default mock) so callers can run real
// sessions in a controlled environment or fully-mocked sessions in
// tests. This is the bridge the meta-system uses to answer questions
// like "what if we add this agent?" *before* actually doing it.
//
// 借鉴 opencode: mirrors `Agent.Service.generate()`'s "describe an agent
// in prose → get a usable definition back" pattern. Instead of generating
// an agent, this one generates an *execution prediction*.
// ============================================================================

/**
 * Minimal contract for a runnable opencode session. Loosely typed so the
 * twin can pass arbitrary teamIds (which aren't strict `AgentRole`
 * literals) and have both the real `OpencodeExecutor` and a mock
 * implementation accept the call. Callers that want strict
 * `AgentRole`-typed routing should construct the `Task` themselves and
 * pass it in.
 */
export interface OpencodeExecutorLike {
  executeTask(
    task: { id: string; description: string; agentRole: string },
    workspaceId: string,
  ): Promise<ExecuteResult>;
}

/** Step granularity used when reporting a simulated session. */
export interface SimulatedStep {
  index: number;
  description: string;
  output: string;
  tokens: number;
}

/**
 * Predicted outcome of a simulated opencode session. `success` is the
 * single signal callers gate on; `failure` carries the reason when
 * `success === false`; `estimatedTokenCost` is the projected billable
 * token cost in USD-like units (Maximilian doesn't tie to a real price
 * table — callers map this to their cost model).
 */
export interface SimulationOutcome {
  teamId: string;
  scenario: string;
  success: boolean;
  failure?: { reason: string; atStep: number };
  estimatedTokenCost: number;
  steps: number;
  artifacts: string[];
  startedAt: string;
  completedAt: string;
  /** Whether the executor was the default mock (vs. a real OpencodeExecutor). */
  mocked: boolean;
}

export interface OpencodeDigitalTwinOptions {
  /** Inject a real OpencodeExecutor (or any OpencodeExecutorLike) to run actual sessions. */
  executor?: OpencodeExecutorLike;
  /**
   * Override the per-step token cost estimate. Defaults to a flat
   * 200 tokens per step, which roughly matches short opencode responses.
   */
  tokensPerStep?: number;
  /**
   * Failure probability per step. Defaults to 0.0 (always succeed) so
   * the simulator is a useful optimistic predictor; tests / pessimistic
   * scenarios can raise this.
   */
  failureProbability?: number;
  /**
   * Source of randomness. Injectable so tests get deterministic runs.
   * Returns a float in [0, 1).
   */
  rng?: () => number;
  /** Override the current time (for deterministic tests). */
  now?: () => Date;
  /** ID generator; defaults to `randomUUID()`. */
  idGenerator?: () => string;
}

const DEFAULT_TOKENS_PER_STEP = 200;
const DEFAULT_FAILURE_PROBABILITY = 0;

/**
 * Simple mocked executor. Produces a deterministic-looking ExecuteResult
 * without touching the network. Used when no real executor is injected
 * so the twin is useful out-of-the-box (e.g. for evaluation scripts).
 *
 * The mock's `agentRole` field is constrained to a valid `AgentRole`
 * literal because `ExecuteResult.result.agentRole` is typed strictly
 * (via `z.enum`). Callers that pass arbitrary strings via the
 * `OpencodeExecutorLike` interface get a default `general` role here;
 * real executors don't have this constraint.
 */
function createDefaultMockExecutor(): OpencodeExecutorLike {
  return {
    async executeTask(task) {
      const sessionId = `mock-${randomUUID().slice(0, 8)}`;
      const result: ExecuteResult = {
        result: {
          id: `r-${task.id}`,
          taskId: task.id,
          agentRole: "general",
          agentId: "opencode-mock",
          output: `[mock] ${task.description}`,
          metadata: { sessionId, executor: "mock" },
          createdAt: new Date().toISOString(),
          durationMs: 0,
        },
        sessionId,
        durationMs: 0,
      };
      return result;
    },
  };
}

/**
 * OpencodeDigitalTwin — predict the outcome of running a scenario through
 * opencode *before* committing. Use cases include:
 *   - "what if we add this agent?" → scenario = task prompt, maxSteps = N
 *   - "what does a planner-style team cost?" → scenario = plan request
 *
 * The class wraps an `OpencodeExecutorLike`; callers can either pass a
 * real OpencodeExecutor (for end-to-end runs in a sandbox) or rely on
 * the default mock (for offline prediction).
 */
export class OpencodeDigitalTwin {
  private readonly executor: OpencodeExecutorLike;
  private readonly executorIsMock: boolean;
  private readonly tokensPerStep: number;
  private readonly failureProbability: number;
  private readonly rng: () => number;
  private readonly now: () => Date;
  private readonly idGenerator: () => string;

  constructor(opts: OpencodeDigitalTwinOptions = {}) {
    if (opts.executor) {
      this.executor = opts.executor;
      this.executorIsMock = false;
    } else {
      this.executor = createDefaultMockExecutor();
      this.executorIsMock = true;
    }
    this.tokensPerStep = Math.max(0, opts.tokensPerStep ?? DEFAULT_TOKENS_PER_STEP);
    this.failureProbability = clamp01(opts.failureProbability ?? DEFAULT_FAILURE_PROBABILITY);
    this.rng = opts.rng ?? Math.random;
    this.now = opts.now ?? (() => new Date());
    this.idGenerator = opts.idGenerator ?? (() => randomUUID());
  }

  /**
   * Run a simulated opencode session for `teamId` under `scenario`.
   * The executor is invoked once to obtain a session id; then the twin
   * walks up to `maxSteps` virtual steps, each contributing to the
   * `estimatedTokenCost` and possibly flipping the outcome to `failed`
   * based on `failureProbability`.
   */
  async simulate(input: {
    teamId: string;
    scenario: string;
    maxSteps: number;
  }): Promise<SimulationOutcome> {
    const teamId = requireString(input.teamId, "teamId");
    const scenario = requireString(input.scenario, "scenario");
    const maxSteps = sanitizeMaxSteps(input.maxSteps);

    const startedAt = this.now().toISOString();
    const stepDescs: string[] = [];
    let tokens = 0;
    let failureAt: number | undefined;
    let failureReason: string | undefined;
    const artifacts: string[] = [];

    // Step 0: kick off a real (or mocked) session so we get a session id
    // and downstream consumers can correlate the simulation with the
    // opencode server. Failures here short-circuit the simulation.
    let executorSessionId: string | undefined;
    try {
      const exec = await this.executor.executeTask(
        {
          id: this.idGenerator(),
          description: scenario,
          agentRole: teamId,
        },
        teamId,
      );
      executorSessionId = exec.sessionId;
      artifacts.push(`session:${exec.sessionId}`);
    } catch (err) {
      failureAt = 0;
      failureReason = err instanceof Error ? err.message : String(err);
    }

    // Steps 1..maxSteps: model each step as a token-emitting, possibly-
    // failing operation. The mock executor is a black box; the
    // simulation walks discrete steps on top of it.
    const upperBound = failureAt !== undefined ? failureAt : maxSteps;
    for (let i = 1; i <= upperBound; i++) {
      const stepTokens = this.tokensPerStep;
      tokens += stepTokens;
      stepDescs.push(`step ${i} for ${teamId}`);

      if (this.failureProbability > 0 && this.rng() < this.failureProbability) {
        failureAt = i;
        failureReason = `random failure at step ${i} (p=${this.failureProbability})`;
        break;
      }
    }

    const completedAt = this.now().toISOString();
    const success = failureAt === undefined;

    return {
      teamId,
      scenario,
      success,
      ...(failureAt !== undefined && failureReason !== undefined
        ? { failure: { reason: failureReason, atStep: failureAt } }
        : {}),
      estimatedTokenCost: tokens,
      steps: stepDescs.length,
      artifacts: executorSessionId
        ? artifacts
        : [...artifacts, `executor-mock:${this.idGenerator().slice(0, 8)}`],
      startedAt,
      completedAt,
      mocked: this.executorIsMock,
    };
  }

  /**
   * Convenience: predict the outcome *and* a step-by-step trace. Useful
   * for "what if we add this agent?" dashboards.
   */
  async simulateWithTrace(input: {
    teamId: string;
    scenario: string;
    maxSteps: number;
  }): Promise<{ outcome: SimulationOutcome; trace: SimulatedStep[] }> {
    const outcome = await this.simulate(input);
    // Reconstruct a synthetic trace from the outcome. The full step
    // trace isn't preserved by `simulate` (it only stores counts); this
    // is a best-effort replay for callers that want per-step detail.
    const trace: SimulatedStep[] = [];
    const perStep = this.tokensPerStep;
    const steps = outcome.steps;
    for (let i = 0; i < steps; i++) {
      trace.push({
        index: i,
        description: `step ${i + 1} for ${input.teamId}`,
        output: outcome.success ? "ok" : `failed at step ${outcome.failure?.atStep ?? "?"}`,
        tokens: perStep,
      });
    }
    return { outcome, trace };
  }
}

// ── helpers (module-local) ────────────────────────────────────────────────

function requireString(value: string, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`OpencodeDigitalTwin: \`${name}\` is required and must be a non-empty string`);
  }
  return value;
}

function sanitizeMaxSteps(value: number): number {
  if (!Number.isFinite(value)) return 1;
  const i = Math.trunc(value);
  if (i < 1) return 1;
  // Cap to a sane upper bound so a misconfigured caller can't trigger
  // unbounded loops in the simulator.
  return Math.min(i, 1000);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}