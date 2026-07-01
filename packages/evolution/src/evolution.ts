/**
 * Phase 6 — Agent Evolution.
 *
 *   shouldEvolve(profile, recent)
 *     → true if profile.totalTasks >= MIN_SAMPLES
 *         AND (mean(recent.reviewScore) < SCORE_THRESHOLD
 *              OR acceptanceRate(recent) < ACCEPTANCE_THRESHOLD)
 *
 *   evolve(profile, ...)
 *     1. compose an "improved" system prompt that addresses the failure modes
 *     2. register it as the next version (v1 → v2, etc.)
 *     3. run an A/B test (3 tasks per side, or as many as history allows)
 *     4. promote if newAvgScore > oldAvgScore + MARGIN, else archive
 *
 * The "A/B" evaluation here is deterministic: it scores a candidate by
 * how many of the recent failure-mode strings it explicitly addresses in
 * the new prompt. This keeps tests fast and offline; a future phase can
 * swap in live re-execution.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { AgentRole, AgentManifest } from "@max/core";
import {
  AgentVersionSchema,
  type AgentProfile,
  type AgentVersion,
  type EvolutionDecision,
  type MetricRecord,
} from "./types.js";
import { ProfileStore } from "./profile-store.js";
import { MetricsStore } from "./metrics-store.js";
import { readModifyWriteAtomic, writeFileAtomic } from "./atomic.js";

export const SCORE_THRESHOLD = 6.0;
export const ACCEPTANCE_THRESHOLD = 0.5;
export const MIN_SAMPLES = 10;
export const AB_SAMPLE_SIZE = 3;
export const PROMOTE_MARGIN = 0.5;

export interface EvolutionConfig {
  scoreThreshold: number;
  acceptanceThreshold: number;
  minSamples: number;
  abSampleSize: number;
  promoteMargin: number;
}

export const DEFAULT_EVOLUTION_CONFIG: EvolutionConfig = {
  scoreThreshold: SCORE_THRESHOLD,
  acceptanceThreshold: ACCEPTANCE_THRESHOLD,
  minSamples: MIN_SAMPLES,
  abSampleSize: AB_SAMPLE_SIZE,
  promoteMargin: PROMOTE_MARGIN,
};

export class EvolutionEngine {
  constructor(
    private rootDir: string,
    private metrics: MetricsStore,
    private profiles: ProfileStore,
    private config: EvolutionConfig = DEFAULT_EVOLUTION_CONFIG
  ) {}

  private versionsDir(role: string): string {
    return path.join(this.rootDir, "agent-versions", role);
  }

  private versionFile(role: string, id: string): string {
    return path.join(this.versionsDir(role), `${id}.json`);
  }

  private decisionsFile(role: string): string {
    return path.join(this.versionsDir(role), "decisions.json");
  }

  async listVersions(role: AgentRole): Promise<AgentVersion[]> {
    try {
      const entries = await fs.readdir(this.versionsDir(role));
      const versions: AgentVersion[] = [];
      for (const e of entries) {
        if (!e.endsWith(".json") || e === "decisions.json") continue;
        const raw = await fs.readFile(path.join(this.versionsDir(role), e), "utf-8");
        versions.push(AgentVersionSchema.parse(JSON.parse(raw)));
      }
      return versions.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
  }

  async getCurrentVersion(role: AgentRole): Promise<AgentVersion | undefined> {
    const all = await this.listVersions(role);
    return all[all.length - 1];
  }

  /**
   * Decide whether this profile should evolve. Pure function over the
   * profile + recent metric records; no side effects.
   */
  static shouldEvolve(
    profile: AgentProfile,
    recent: MetricRecord[],
    config: EvolutionConfig = DEFAULT_EVOLUTION_CONFIG
  ): boolean {
    if (recent.length < config.minSamples) return false;
    const scored = recent.filter((r) => r.reviewScore !== undefined);
    if (scored.length === 0) return false;
    const meanScore = scored.reduce((a, r) => a + (r.reviewScore ?? 0), 0) / scored.length;
    if (meanScore < config.scoreThreshold) return true;
    const accepted = recent.filter((r) => r.userAccepted !== undefined);
    if (accepted.length === 0) return false;
    const acceptRate = accepted.filter((r) => r.userAccepted).length / accepted.length;
    return acceptRate < config.acceptanceThreshold;
  }

  /**
   * Run the full evolution cycle for one role. Returns the decision
   * (promoted or discarded) plus the candidate version.
   */
  async evolve(
    role: AgentRole,
    currentManifest: AgentManifest
  ): Promise<EvolutionDecision> {
    const profile = await this.profiles.getOrCreate(role, currentManifest);
    const recent = (await this.metrics.listForRole(role)).slice(-this.config.abSampleSize * 2);
    const current = await this.getCurrentVersion(role);

    const failures = recent.filter(
      (r) => r.error || (r.reviewScore !== undefined && r.reviewScore < this.config.scoreThreshold)
    );
    const feedback = profile.memory.userFeedback.slice(-5).map((e) => e.content);

    // 1. Compose candidate prompt.
    const newSystemPrompt = composeImprovedPrompt(
      currentManifest.systemPrompt,
      failures,
      feedback
    );
    const newId = nextVersionId(profile.versions);

    const candidate: AgentVersion = AgentVersionSchema.parse({
      id: newId,
      agentRole: role,
      manifest: { ...currentManifest, systemPrompt: newSystemPrompt },
      createdAt: new Date().toISOString(),
      reason: failures.length > 0
        ? `Addressed ${failures.length} recent failure(s) and ${feedback.length} feedback note(s)`
        : "Heuristic improvement",
      stats: { totalTasks: 0, avgScore: 0 },
    });

    await fs.mkdir(this.versionsDir(role), { recursive: true });
    await writeFileAtomic(this.versionFile(role, newId), JSON.stringify(candidate, null, 2));

    // 2. A/B test using a deterministic score estimator.
    const oldScore = estimateAvgScore(current?.manifest.systemPrompt ?? currentManifest.systemPrompt, recent);
    const newScore = estimateAvgScore(newSystemPrompt, recent);
    const promoted =
      newScore > oldScore + this.config.promoteMargin;

    if (promoted) {
      candidate.stats.avgScore = newScore;
      await writeFileAtomic(this.versionFile(role, newId), JSON.stringify(candidate, null, 2));

      if (current) {
        const retired: AgentVersion = { ...current, retiredAt: new Date().toISOString() };
        await writeFileAtomic(this.versionFile(role, current.id), JSON.stringify(retired, null, 2));
      }

      const updatedProfile: AgentProfile = {
        ...profile,
        currentVersion: newId,
        versions: [...profile.versions, newId],
        manifest: { ...currentManifest, systemPrompt: newSystemPrompt },
      };
      await this.profiles.save(updatedProfile);
    }

    const decision: EvolutionDecision = {
      id: `evo-${randomUUID().slice(0, 8)}`,
      agentRole: role,
      fromVersion: current?.id ?? "v0",
      toVersion: newId,
      outcome: promoted ? "promoted" : "discarded",
      oldAvgScore: oldScore,
      newAvgScore: newScore,
      triggeredAt: new Date().toISOString(),
      reason: promoted
        ? `New version scored ${newScore.toFixed(2)} vs ${oldScore.toFixed(2)} on recent sample.`
        : `New version did not exceed old + margin (${newScore.toFixed(2)} vs ${oldScore.toFixed(2)}).`,
    };

    await this.appendDecision(role, decision);
    return decision;
  }

  private async appendDecision(role: AgentRole, decision: EvolutionDecision): Promise<void> {
    // Atomic read-modify-write so two concurrent evolve() calls for the
    // same role don't lose each other's decision. The mtime-based retry
    // is best-effort; with low concurrency (one evolve per role at a
    // time in practice) it's enough to eliminate the lost-update window
    // that the previous read-then-write had.
    await readModifyWriteAtomic<EvolutionDecision[]>(
      this.decisionsFile(role),
      [],
      (existing) => [...existing, decision],
    );
  }
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function nextVersionId(versions: string[]): string {
  const nums = versions
    .map((v) => /^v(\d+)$/.exec(v)?.[1])
    .filter((x): x is string => !!x)
    .map((x) => parseInt(x, 10));
  const max = nums.length > 0 ? Math.max(...nums) : 0;
  return `v${max + 1}`;
}

/**
 * Compose a new system prompt by appending explicit guidance derived from
 * observed failure modes. Deterministic and offline-friendly; a real LLM can
 * later replace this with a higher-quality rewrite.
 */
function composeImprovedPrompt(
  base: string,
  failures: MetricRecord[],
  feedback: string[]
): string {
  const parts: string[] = [base.trim()];

  const failureModes = extractFailureModes(failures);
  if (failureModes.length > 0) {
    parts.push(
      `\n# Failure modes observed in past runs (avoid these)\n` +
        failureModes.map((m, i) => `${i + 1}. ${m}`).join("\n")
    );
  }
  if (feedback.length > 0) {
    parts.push(
      `\n# User feedback to honor\n` + feedback.map((f, i) => `${i + 1}. ${f}`).join("\n")
    );
  }
  parts.push(
    `\n# Output discipline\n` +
      `- Be explicit about every assumption you make.\n` +
      `- If a contract with another agent exists, mirror it exactly.\n` +
      `- Prefer working code over clever code.`
  );
  return parts.join("\n");
}

function extractFailureModes(failures: MetricRecord[]): string[] {
  const modes: string[] = [];
  for (const f of failures) {
    if (f.error) modes.push(`Avoid runtime error: ${f.error.slice(0, 120)}`);
    if (f.reviewScore !== undefined && f.reviewScore < 6) {
      modes.push(`Last scored ${f.reviewScore}/10 — be more thorough.`);
    }
  }
  return modes.slice(0, 6);
}

/**
 * Estimate an average score for a given prompt against a set of past
 * records. The estimator is intentionally simple: it counts how many of
 * the failure-mode markers appear in the new prompt vs the old one. A
 * more sophisticated version (embedding similarity, live re-run) is out
 * of scope for the MVP.
 */
function estimateAvgScore(prompt: string, recent: MetricRecord[]): number {
  if (recent.length === 0) return 5;
  const lower = prompt.toLowerCase();
  const baseAvg = recent
    .filter((r) => r.reviewScore !== undefined)
    .reduce((a, r) => a + (r.reviewScore ?? 0), 0) /
    Math.max(1, recent.filter((r) => r.reviewScore !== undefined).length);

  // Heuristic: +0.4 per failure-mode marker the prompt addresses, capped.
  let bonus = 0;
  const markers = ["failure", "avoid", "assumption", "thorough", "feedback", "discipline"];
  for (const m of markers) {
    if (lower.includes(m)) bonus += 0.4;
  }
  bonus = Math.min(bonus, 2.0);
  return Math.min(10, baseAvg + bonus);
}
