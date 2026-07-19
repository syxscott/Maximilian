/**
 * Agent Evolution Engine — data structures.
 *
 * Six schemas cover the six phases of evolution:
 *   1. MetricRecord    — recorded per task execution
 *   2. AgentProfile    — long-term per-role record
 *   3. AgentMemory     — buckets of feedback / examples
 *   4. LeaderboardEntry — aggregated (role, provider, model)
 *   5. AgentVersion    — snapshot of a role's prompt
 *   6. EvolutionDecision — why a version was promoted/retired
 */

import { z } from "zod";
import { AgentRole, AgentManifestSchema } from "@max/core";

// ============================================================================
// Metric Record (Phase 1)
// ============================================================================

export const MetricRecordSchema = z.object({
  taskId: z.string(),
  agentId: z.string(),
  agentRole: AgentRole,
  provider: z.string(),
  model: z.string(),
  executionTime: z.number().nonnegative(),       // ms
  tokenInput: z.number().int().nonnegative(),
  tokenOutput: z.number().int().nonnegative(),
  /** Tokens served from provider-side prompt cache (Anthropic cache_read_input_tokens,
   *  OpenAI prompt_tokens_details.cached_tokens). 0 if provider doesn't report or
   *  caching isn't enabled. */
  cacheReadTokens: z.number().int().nonnegative().default(0),
  /** Tokens written into provider-side cache (Anthropic cache_creation_input_tokens).
   *  Always 0 for OpenAI-style protocols. */
  cacheCreationTokens: z.number().int().nonnegative().default(0),
  reviewScore: z.number().min(0).max(10).optional(),
  userAccepted: z.boolean().optional(),
  retryCount: z.number().int().nonnegative().default(0),
  error: z.string().optional(),
  timestamp: z.string(),                          // ISO
});
export type MetricRecord = z.infer<typeof MetricRecordSchema>;

// ============================================================================
// Agent Memory (Phase 5)
// ============================================================================

/**
 * Common MIME types for memory entries. Mirrors autogen's `MemoryContent`
 * protocol: agents can carry typed payloads (text / json / image / file)
 * through the long-term store instead of opaque strings.
 */
export const MemoryMime = {
  TextPlain: "text/plain",
  ApplicationJson: "application/json",
  ImagePng: "image/png",
  ImageJpeg: "image/jpeg",
  ApplicationMarkdown: "application/markdown",
  TextDigest: "text/digest",
} as const
export type MemoryMime = (typeof MemoryMime)[keyof typeof MemoryMime]

/**
 * One memory entry. `content` is always a string — JSON payloads should be
 * stored as the string form so the schema stays simple, but the `mime`
 * field lets consumers route appropriately. `metadata` is free-form
 * (timestamps, source task ID, score, etc.).
 */
export const MemoryEntrySchema = z.object({
  mime: z.string().default(MemoryMime.TextPlain),
  content: z.string(),
  metadata: z.record(z.unknown()).optional(),
})
export type MemoryEntry = z.infer<typeof MemoryEntrySchema>

/**
 * Coerce a free-form value (legacy string, plain object, or already-typed
 * entry) into a MemoryEntry. This keeps the upgrade non-breaking: existing
 * call sites that pass raw strings continue to work.
 */
export function toMemoryEntry(value: unknown, mime: MemoryMime = MemoryMime.TextPlain): MemoryEntry {
  if (value === null || value === undefined) return { mime, content: "" }
  if (typeof value === "string") return { mime, content: value }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>
    if (typeof obj.content === "string" && typeof obj.mime === "string") {
      return {
        mime: obj.mime,
        content: obj.content,
        metadata: (obj.metadata as Record<string, unknown> | undefined) ?? undefined,
      }
    }
    return { mime: MemoryMime.ApplicationJson, content: JSON.stringify(obj) }
  }
  return { mime, content: String(value) }
}

/**
 * Preprocessor for a memory bucket. Legacy profile JSON stored each bucket
 * as a plain `string[]`; the current schema wants `MemoryEntry[]`. Without
 * this coercion `AgentProfileSchema.parse()` would throw on every old
 * profile file and break the very first read after deploy.
 */
const legacyBucket = z.preprocess((raw) => {
  if (!Array.isArray(raw)) return raw
  return raw.map((item) => toMemoryEntry(item))
}, z.array(MemoryEntrySchema))

export const AgentMemorySchema = z.object({
  userFeedback: legacyBucket.default([]),
  reviewSuggestions: legacyBucket.default([]),
  commonErrors: legacyBucket.default([]),
  goodExamples: legacyBucket.default([]),
  totalEntries: z.number().int().nonnegative().default(0),
  compressedAt: z.string().optional(),
});
export type AgentMemory = z.infer<typeof AgentMemorySchema>;

// ============================================================================
// Agent Profile (Phase 2)
// ============================================================================

export const AgentProfileSchema = z.object({
  id: z.string(),                                 // equals role
  role: AgentRole,
  createdAt: z.string(),
  totalTasks: z.number().int().nonnegative().default(0),
  avgScore: z.number().min(0).max(10).default(0),
  successRate: z.number().min(0).max(1).default(1),
  avgExecutionTime: z.number().nonnegative().default(0),
  preferredModel: z.string().optional(),          // provider:model
  strengths: z.array(z.string()).default([]),
  weaknesses: z.array(z.string()).default([]),
  memory: AgentMemorySchema.default({}),
  currentVersion: z.string().default("v1"),
  versions: z.array(z.string()).default(["v1"]),
  manifest: AgentManifestSchema.optional(),       // active prompt snapshot
});
export type AgentProfile = z.infer<typeof AgentProfileSchema>;

// ============================================================================
// Leaderboard Entry (Phase 3)
// ============================================================================

export const LeaderboardEntrySchema = z.object({
  agentRole: AgentRole,
  provider: z.string(),
  model: z.string(),
  avgScore: z.number().min(0).max(10),
  avgExecutionTime: z.number().nonnegative(),
  avgCostUSD: z.number().nonnegative(),           // approximate
  userSatisfaction: z.number().min(0).max(1),     // acceptance rate
  sampleSize: z.number().int().nonnegative(),
  lastUpdated: z.string(),
  // Counterfactual dimensions (borrowed from EvoAgentBench):
  // - baselineScore is the score *before* the most recent evolution
  //   (paired-comparison), so the leaderboard can answer "did evolving
  //   this agent pay off, net of cost?"
  // - deltaScore = avgScore - baselineScore (signed, can be negative).
  // - costDeltaUSD = signed cost delta vs the prior version; a small
  //   accuracy gain bought with a large token/turn increase is flagged
  //   rather than hidden.
  baselineScore: z.number().min(0).max(10).optional(),
  deltaScore: z.number().optional(),
  costDeltaUSD: z.number().optional(),
  /** Per-version history of from→to decisions. */
  versionHistory: z
    .array(
      z.object({
        fromVersion: z.string(),
        toVersion: z.string(),
        outcome: z.enum(["promoted", "discarded"]),
        oldAvgScore: z.number(),
        newAvgScore: z.number(),
        triggeredAt: z.string(),
        reason: z.string(),
      }),
    )
    .default([]),
});
export type LeaderboardEntry = z.infer<typeof LeaderboardEntrySchema>;

export const LeaderboardSchema = z.object({
  entries: z.array(LeaderboardEntrySchema).default([]),
  lastRebuilt: z.string().optional(),
});
export type LeaderboardData = z.infer<typeof LeaderboardSchema>;

// ============================================================================
// Agent Version (Phase 6)
// ============================================================================

export const AgentVersionSchema = z.object({
  id: z.string(),                                 // e.g. "v1", "v2"
  agentRole: AgentRole,
  manifest: AgentManifestSchema,
  createdAt: z.string(),
  retiredAt: z.string().optional(),
  reason: z.string().default("initial"),
  stats: z.object({
    totalTasks: z.number().int().nonnegative().default(0),
    avgScore: z.number().min(0).max(10).default(0),
  }),
});
export type AgentVersion = z.infer<typeof AgentVersionSchema>;

// ============================================================================
// Evolution Decision
// ============================================================================

export const EvolutionDecisionSchema = z.object({
  id: z.string(),
  agentRole: AgentRole,
  fromVersion: z.string(),
  toVersion: z.string(),
  outcome: z.enum(["promoted", "discarded"]),
  oldAvgScore: z.number(),
  newAvgScore: z.number(),
  triggeredAt: z.string(),
  reason: z.string(),
});
export type EvolutionDecision = z.infer<typeof EvolutionDecisionSchema>;

// ============================================================================
// Model Selection Output
// ============================================================================

export const ModelSelectionSchema = z.object({
  provider: z.string(),
  model: z.string(),
  score: z.number(),
  reason: z.string(),
});
export type ModelSelection = z.infer<typeof ModelSelectionSchema>;

// ============================================================================
// Default memory factory
// ============================================================================

export function emptyMemory(): AgentMemory {
  return {
    userFeedback: [],
    reviewSuggestions: [],
    commonErrors: [],
    goodExamples: [],
    totalEntries: 0,
  };
}

/**
 * Helper: read out only the string content of an entry. Most call sites
 * that used to do `mem.userFeedback[i]` now read `entryContent(mem.userFeedback[i])`.
 */
export function entryContent(entry: MemoryEntry | string | undefined): string {
  if (entry === undefined) return ""
  if (typeof entry === "string") return entry
  return entry.content
}
