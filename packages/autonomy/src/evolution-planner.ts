/**
 * 5.4 — EvolutionPlanner
 *
 * Given recent executions + reviews + failure insights + user feedback,
 * decide whether evolution is warranted and produce an EvolutionPlan.
 */

import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  EvolutionPlanSchema,
  PLANNER_CONFIG,
  type EvolutionPlan,
  type ExecutionRecord,
  type FailureInsight,
  type StructuredReview,
  type PlanChange,
} from "./types.js";

export interface PlannerInput {
  role: string;
  currentVersion: string;
  executions: ExecutionRecord[];
  reviews: StructuredReview[];
  failureInsights: FailureInsight[];
  userFeedback: string[];
}

export interface PlannerConfig {
  minExecutions: number;
  scoreThreshold: number;
  acceptanceThreshold: number;
  topFailureCount: number;
}

export const DEFAULT_PLANNER_CONFIG: PlannerConfig = PLANNER_CONFIG;

export class EvolutionPlanner {
  constructor(
    private rootDir: string,
    private config: PlannerConfig = DEFAULT_PLANNER_CONFIG
  ) {}

  private dir(): string {
    return path.join(this.rootDir, "evolution-plans");
  }

  private fileFor(id: string): string {
    return path.join(this.dir(), `${id}.json`);
  }

  async savePlan(plan: EvolutionPlan): Promise<void> {
    const validated = EvolutionPlanSchema.parse(plan);
    await fs.mkdir(this.dir(), { recursive: true });
    await fs.writeFile(this.fileFor(validated.id), JSON.stringify(validated, null, 2), "utf-8");
  }

  async listPlans(): Promise<EvolutionPlan[]> {
    try {
      const entries = await fs.readdir(this.dir());
      const out: EvolutionPlan[] = [];
      for (const name of entries) {
        if (!name.endsWith(".json")) continue;
        const raw = await fs.readFile(path.join(this.dir(), name), "utf-8");
        out.push(EvolutionPlanSchema.parse(JSON.parse(raw)));
      }
      return out;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
  }

  /**
   * Decide whether to evolve a role, and if so, produce a plan.
   * Returns null when the role is performing well enough.
   */
  plan(input: PlannerInput): EvolutionPlan | null {
    if (input.executions.length < this.config.minExecutions) return null;

    const scored = input.executions
      .map((e) => e.review?.score)
      .filter((s): s is number => s !== undefined);
    if (scored.length === 0) return null;

    const avgScore = scored.reduce((a, s) => a + s, 0) / scored.length;
    const accepted = input.executions
      .map((e) => e.userFeedback?.length > 0)
      .filter(Boolean).length;
    const acceptance = input.executions.length > 0
      ? accepted / input.executions.length
      : 0;

    const needsEvolution =
      avgScore < this.config.scoreThreshold ||
      acceptance < this.config.acceptanceThreshold;
    if (!needsEvolution) return null;

    const topFailures = input.failureInsights
      .slice(0, this.config.topFailureCount)
      .map((i) => i.pattern);
    const topSuggestions = input.reviews
      .flatMap((r) => r.improvementSuggestions)
      .slice(0, this.config.topFailureCount);

    const changes = this.proposeChanges(input, topFailures, topSuggestions);
    const expectedImprovement = {
      score: Math.max(1, this.config.scoreThreshold - avgScore),
      acceptance: Math.max(0.1, this.config.acceptanceThreshold - acceptance),
    };

    const plan = EvolutionPlanSchema.parse({
      id: `plan-${randomUUID()}`,
      agentRole: input.role,
      fromVersion: input.currentVersion,
      toVersion: nextVersion(input.currentVersion),
      changes,
      expectedImprovement,
      basedOn: {
        executionCount: input.executions.length,
        avgScore,
        acceptance,
        topFailurePatterns: topFailures,
        topSuggestions,
      },
      createdAt: new Date().toISOString(),
      status: "draft",
    });

    return plan;
  }

  private proposeChanges(
    input: PlannerInput,
    failures: string[],
    suggestions: string[]
  ): PlanChange[] {
    const out: PlanChange[] = [];
    const promptFragments: string[] = [];

    if (failures.length > 0) {
      promptFragments.push(
        `# Failure modes to avoid\n` +
          failures.map((f, i) => `${i + 1}. ${f}`).join("\n")
      );
    }
    if (suggestions.length > 0) {
      promptFragments.push(
        `# Improvement directives\n` +
          suggestions.map((s, i) => `${i + 1}. ${s}`).join("\n")
      );
    }
    if (input.userFeedback.length > 0) {
      promptFragments.push(
        `# User feedback to honor\n` +
          input.userFeedback
            .slice(-5)
            .map((f, i) => `${i + 1}. ${f}`)
            .join("\n")
      );
    }
    if (promptFragments.length === 0) {
      promptFragments.push("# Be more thorough and explicit about constraints.");
    }
    promptFragments.push(
      `# Output discipline\n` +
        `- State assumptions explicitly.\n` +
        `- If a contract with another agent exists, mirror it exactly.\n` +
        `- Prefer working code over clever code.`
    );

    out.push({
      type: "systemPrompt",
      to: promptFragments.join("\n\n"),
      reason:
        failures.length > 0
          ? `Address ${failures.length} recurring failure pattern(s)`
          : `Strengthen output discipline for ${input.role}`,
    });
    return out;
  }
}

function nextVersion(current: string): string {
  const m = /^v(\d+)$/.exec(current);
  const n = m ? parseInt(m[1]!, 10) + 1 : 2;
  return `v${n}`;
}
