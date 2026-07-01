/**
 * 5.5 — CandidateGenerator
 *
 * Takes an EvolutionPlan + a parent blueprint and produces a
 * CandidateVersion (a new blueprint that incorporates the plan's
 * changes). Persists to <rootDir>/candidates/.
 */

import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  CandidateVersionSchema,
  type CandidateVersion,
  type EvolutionPlan,
  type PlanChange,
} from "./types.js";
import type { AgentBlueprint } from "@max/dags";

export class CandidateGenerator {
  constructor(private rootDir: string) {}

  private dir(): string {
    return path.join(this.rootDir, "candidates");
  }

  private fileFor(id: string): string {
    return path.join(this.dir(), `${id}.json`);
  }

  async listAll(): Promise<CandidateVersion[]> {
    try {
      const entries = await fs.readdir(this.dir());
      const out: CandidateVersion[] = [];
      for (const name of entries) {
        if (!name.endsWith(".json")) continue;
        const raw = await fs.readFile(path.join(this.dir(), name), "utf-8");
        out.push(CandidateVersionSchema.parse(JSON.parse(raw)));
      }
      return out;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
  }

  async get(id: string): Promise<CandidateVersion | undefined> {
    try {
      const raw = await fs.readFile(this.fileFor(id), "utf-8");
      return CandidateVersionSchema.parse(JSON.parse(raw));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw err;
    }
  }

  async generate(
    plan: EvolutionPlan,
    parent: AgentBlueprint
  ): Promise<CandidateVersion> {
    const newPrompt = applyChanges(parent.systemPrompt, plan.changes);
    const id = `bp-${parent.role}-${plan.toVersion}-${randomUUID().slice(0, 6)}`;

    const candidate = CandidateVersionSchema.parse({
      id,
      agentRole: parent.role,
      version: plan.toVersion,
      parentBlueprintId: parent.id,
      parentVersion: parent.version,
      systemPrompt: newPrompt,
      changes: plan.changes,
      generationReason: plan.changes.map((c) => c.reason),
      planId: plan.id,
      createdAt: new Date().toISOString(),
      stats: { totalRuns: 0, avgScore: 0, acceptance: 0 },
      status: "candidate",
    });

    await fs.mkdir(this.dir(), { recursive: true });
    await fs.writeFile(this.fileFor(id), JSON.stringify(candidate, null, 2), "utf-8");
    return candidate;
  }

  async updateStats(
    id: string,
    stats: { totalRuns: number; avgScore: number; acceptance: number }
  ): Promise<CandidateVersion> {
    const existing = await this.get(id);
    if (!existing) throw new Error(`Candidate ${id} not found`);
    const updated: CandidateVersion = {
      ...existing,
      stats: {
        totalRuns: stats.totalRuns,
        avgScore: stats.avgScore,
        acceptance: stats.acceptance,
      },
    };
    await fs.writeFile(this.fileFor(id), JSON.stringify(updated, null, 2), "utf-8");
    return updated;
  }

  async setStatus(
    id: string,
    status: CandidateVersion["status"]
  ): Promise<CandidateVersion> {
    const existing = await this.get(id);
    if (!existing) throw new Error(`Candidate ${id} not found`);
    const updated: CandidateVersion = {
      ...existing,
      status,
      promotedAt: status === "promoted" ? new Date().toISOString() : existing.promotedAt,
      rejectedAt: status === "rejected" ? new Date().toISOString() : existing.rejectedAt,
    };
    await fs.writeFile(this.fileFor(id), JSON.stringify(updated, null, 2), "utf-8");
    return updated;
  }
}

function applyChanges(basePrompt: string, changes: PlanChange[]): string {
  const parts: string[] = [basePrompt.trim()];
  for (const c of changes) {
    if (c.type === "systemPrompt" && c.to) {
      parts.push(`\n# Generated directive (${c.type})\n${c.to}`);
    }
  }
  return parts.join("\n");
}
