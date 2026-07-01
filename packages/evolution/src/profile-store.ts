/**
 * Phase 2 — Agent Profile.
 *
 * One AgentProfile per role. Lives independently of any single workspace
 * (so it survives across many user requests). The lifecycle is:
 *   - getOrCreate(role, defaultManifest) on first sight
 *   - update(role, patch) on each metric landing
 *   - snapshot(role) when the evolution engine needs a stable view
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { AgentRole, AgentManifest } from "@max/core";
import {
  AgentProfileSchema,
  emptyMemory,
  type AgentProfile,
} from "./types.js";

export class ProfileStore {
  constructor(private rootDir: string) {}

  private agentsDir(): string {
    return path.join(this.rootDir, "agents");
  }

  private fileFor(role: string): string {
    return path.join(this.agentsDir(), `${role}.json`);
  }

  async getOrCreate(
    role: AgentRole,
    defaultManifest: AgentManifest
  ): Promise<AgentProfile> {
    const existing = await this.get(role);
    if (existing) return existing;

    const profile: AgentProfile = AgentProfileSchema.parse({
      id: role,
      role,
      createdAt: new Date().toISOString(),
      totalTasks: 0,
      avgScore: 0,
      successRate: 1,
      avgExecutionTime: 0,
      strengths: [],
      weaknesses: [],
      memory: emptyMemory(),
      currentVersion: "v1",
      versions: ["v1"],
      manifest: defaultManifest,
    });
    await this.save(profile);
    return profile;
  }

  async get(role: string): Promise<AgentProfile | undefined> {
    try {
      const raw = await fs.readFile(this.fileFor(role), "utf-8");
      return AgentProfileSchema.parse(JSON.parse(raw));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw err;
    }
  }

  async save(profile: AgentProfile): Promise<void> {
    await fs.mkdir(this.agentsDir(), { recursive: true });
    const validated = AgentProfileSchema.parse(profile);
    await fs.writeFile(this.fileFor(validated.role), JSON.stringify(validated, null, 2), "utf-8");
  }

  async listAll(): Promise<AgentProfile[]> {
    try {
      const entries = await fs.readdir(this.agentsDir());
      const profiles: AgentProfile[] = [];
      for (const name of entries) {
        if (!name.endsWith(".json")) continue;
        const raw = await fs.readFile(path.join(this.agentsDir(), name), "utf-8");
        profiles.push(AgentProfileSchema.parse(JSON.parse(raw)));
      }
      return profiles;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
  }

  /**
   * Recompute aggregate stats from a fresh batch of metrics.
   * Pure function over the profile + records; caller persists.
   */
  static recompute(profile: AgentProfile, records: import("./types.js").MetricRecord[]): AgentProfile {
    if (records.length === 0) return profile;
    const scored = records.filter((r) => r.reviewScore !== undefined);
    const successes = records.filter((r) => !r.error);

    const avgScore = scored.length > 0
      ? scored.reduce((a, r) => a + (r.reviewScore ?? 0), 0) / scored.length
      : profile.avgScore;
    const successRate = successes.length / records.length;
    const avgExecutionTime = records.reduce((a, r) => a + r.executionTime, 0) / records.length;

    return {
      ...profile,
      totalTasks: records.length,
      avgScore,
      successRate,
      avgExecutionTime,
    };
  }
}

export function newEvolutionId(): string {
  return `evo-${randomUUID().slice(0, 8)}`;
}
