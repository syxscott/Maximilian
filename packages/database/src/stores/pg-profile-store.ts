import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { agentProfiles } from "../schema.js";

// Use the same AgentProfile type as ProfileStore from @max/evolution.
// The memory field is stored as JSONB and reconstructed on read.
interface AgentMemory {
  userFeedback: unknown[];
  reviewSuggestions: unknown[];
  commonErrors: unknown[];
  goodExamples: unknown[];
  totalEntries: number;
  compressedAt?: string;
}

interface AgentProfileData {
  id: string;
  role: string;
  createdAt: string;
  totalTasks: number;
  avgScore: number;
  successRate: number;
  avgExecutionTime: number;
  preferredModel?: string;
  strengths: string[];
  weaknesses: string[];
  memory: AgentMemory;
  currentVersion: string;
  versions: string[];
  manifest?: unknown;
}

function emptyMemory(): AgentMemory {
  return { userFeedback: [], reviewSuggestions: [], commonErrors: [], goodExamples: [], totalEntries: 0 };
}

/**
 * PostgreSQL-backed agent profile store.
 * API-compatible with ProfileStore from @max/evolution.
 *
 * Each agent role has one profile row. The `memory` and `manifest` fields
 * are stored as JSONB.
 */
export class PgProfileStore {
  constructor(private db: PostgresJsDatabase) {}

  async get(role: string): Promise<AgentProfileData | undefined> {
    const rows = await this.db
      .select()
      .from(agentProfiles)
      .where(eq(agentProfiles.role, role))
      .limit(1);
    if (rows.length === 0) return undefined;
    return rowToProfile(rows[0]);
  }

  async getOrCreate(role: string, defaultManifest: unknown): Promise<AgentProfileData> {
    const existing = await this.get(role);
    if (existing) return existing;

    const now = new Date().toISOString();
    const profile: AgentProfileData = {
      id: role,
      role,
      createdAt: now,
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
    };
    await this.save(profile);
    return profile;
  }

  async save(profile: AgentProfileData): Promise<void> {
    // Concurrent saves for the same role were silently losing data: each
    // caller's `get()` returned the same baseline, each then mutated its
    // in-memory copy (e.g. appending to memory.userFeedback), and the
    // onConflictDoUpdate below wrote back the full profile — clobbering
    // the other caller's memory entries. Fix: SELECT ... FOR UPDATE in
    // a transaction, then merge `memory` arrays by content union and
    // take the max for aggregate counters. The lock serializes
    // concurrent saves for the same role; different roles don't contend.
    await this.db.transaction(async (tx) => {
      const existingRows = await tx
        .select()
        .from(agentProfiles)
        .where(eq(agentProfiles.role, profile.role))
        .for("update")
        .limit(1);

      const existingMemory: AgentMemory = existingRows.length > 0
        ? rowToMemory(existingRows[0].memory)
        : emptyMemory();
      const existingVersions: string[] = existingRows.length > 0
        ? ((existingRows[0].versions as string[]) ?? [])
        : [];

      const mergedMemory = mergeMemory(existingMemory, profile.memory);
      const mergedVersions = mergeVersions(existingVersions, profile.versions);

      // For aggregates: totalTasks is an increment (增量), so we sum them.
      // If two callers raced and both computed aggregates from different
      // metric windows, taking the sum gives the correct total count.
      const mergedTotalTasks = (
        existingRows[0]?.totalTasks ?? 0
      ) + profile.totalTasks;

      await tx
        .insert(agentProfiles)
        .values({
          id: profile.id,
          role: profile.role,
          createdAt: profile.createdAt,
          totalTasks: profile.totalTasks,
          avgScore: profile.avgScore,
          successRate: profile.successRate,
          avgExecutionTime: profile.avgExecutionTime,
          preferredModel: profile.preferredModel ?? null,
          strengths: profile.strengths,
          weaknesses: profile.weaknesses,
          memory: mergedMemory,
          currentVersion: profile.currentVersion,
          versions: profile.versions,
          manifest: profile.manifest ?? null,
        })
        .onConflictDoUpdate({
          target: agentProfiles.id,
          set: {
            totalTasks: mergedTotalTasks,
            avgScore: profile.avgScore,
            successRate: profile.successRate,
            avgExecutionTime: profile.avgExecutionTime,
            preferredModel: profile.preferredModel ?? null,
            strengths: profile.strengths,
            weaknesses: profile.weaknesses,
            memory: mergedMemory,
            currentVersion: profile.currentVersion,
            versions: mergedVersions,
            manifest: profile.manifest ?? null,
            updatedAt: new Date(),
          },
        });
    });
  }

  async listAll(): Promise<AgentProfileData[]> {
    const rows = await this.db.select().from(agentProfiles);
    return rows.map(rowToProfile);
  }

  /**
   * Recompute aggregate stats from a fresh batch of metrics.
   * Mirrors ProfileStore.recompute() from @max/evolution.
   */
  static recompute(profile: AgentProfileData, records: Array<{ reviewScore?: number; error?: string; executionTime: number }>): AgentProfileData {
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

function rowToProfile(row: typeof agentProfiles.$inferSelect): AgentProfileData {
  return {
    id: row.id,
    role: row.role,
    createdAt: row.createdAt,
    totalTasks: row.totalTasks,
    avgScore: row.avgScore,
    successRate: row.successRate,
    avgExecutionTime: row.avgExecutionTime,
    preferredModel: row.preferredModel ?? undefined,
    strengths: (row.strengths as string[]) ?? [],
    weaknesses: (row.weaknesses as string[]) ?? [],
    memory: rowToMemory(row.memory),
    currentVersion: row.currentVersion,
    versions: (row.versions as string[]) ?? ["v1"],
    manifest: row.manifest ?? undefined,
  };
}

function rowToMemory(raw: unknown): AgentMemory {
  const rawMemory = (raw as Record<string, unknown>) ?? {};
  return {
    userFeedback: (rawMemory.userFeedback as unknown[]) ?? [],
    reviewSuggestions: (rawMemory.reviewSuggestions as unknown[]) ?? [],
    commonErrors: (rawMemory.commonErrors as unknown[]) ?? [],
    goodExamples: (rawMemory.goodExamples as unknown[]) ?? [],
    totalEntries: (rawMemory.totalEntries as number) ?? 0,
    compressedAt: rawMemory.compressedAt as string | undefined,
  };
}

/**
 * Union two memory snapshots by appending the incoming arrays to the
 * existing ones and de-duplicating by JSON content. We can't tell which
 * entries are "new" vs already-stored without per-entry IDs, so the
 * safe choice is to keep both copies. totalEntries takes the max; both
 * writers should be incrementing it from the same baseline, so the
 * higher value reflects more observed activity.
 */
export function mergeMemory(existing: AgentMemory, incoming: AgentMemory): AgentMemory {
  return {
    userFeedback: unionByContent(existing.userFeedback, incoming.userFeedback),
    reviewSuggestions: unionByContent(existing.reviewSuggestions, incoming.reviewSuggestions),
    commonErrors: unionByContent(existing.commonErrors, incoming.commonErrors),
    goodExamples: unionByContent(existing.goodExamples, incoming.goodExamples),
    totalEntries: Math.max(existing.totalEntries, incoming.totalEntries),
    compressedAt: incoming.compressedAt ?? existing.compressedAt,
  };
}

export function unionByContent(a: unknown[], b: unknown[]): unknown[] {
  const seen = new Set<string>();
  const out: unknown[] = [];
  for (const item of a) {
    const key = JSON.stringify(item);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
  }
  for (const item of b) {
    const key = JSON.stringify(item);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

/**
 * Union version lists preserving insertion order. Versions are version
 * strings like "v1", "v2" — appending a newer one is the common case,
 * but two concurrent evolves for the same role shouldn't drop each
 * other's results.
 */
export function mergeVersions(existing: string[], incoming: string[]): string[] {
  const seen = new Set(existing);
  const out = [...existing];
  for (const v of incoming) {
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

// PgProfileStore: PostgreSQL-backed agent profile persistence.
// Replaces file-based ProfileStore from @max/evolution for production use.
