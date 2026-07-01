/**
 * Phase 5 — Autonomous Improvement Loop core types.
 *
 *   ExecutionRecord      5.1 - complete per-task replay context
 *   StructuredReview     5.2 - upgraded Review Agent output
 *   FailureInsight       5.3 - mined failure patterns
 *   EvolutionPlan        5.4 - what to change and why
 *   CandidateVersion     5.5 - generated candidate
 *   PromotionRecord      5.6 - A/B promotion audit
 *   LearningSnapshot     5.7 - dashboard query result
 */

import { z } from "zod";
import { AgentRole } from "@max/core";

// ============================================================================
// 5.2 — StructuredReview
// ============================================================================

export const StructuredReviewSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  workspaceId: z.string(),
  score: z.number().min(0).max(10),
  strengths: z.array(z.string()).default([]),
  weaknesses: z.array(z.string()).default([]),
  failurePatterns: z.array(z.string()).default([]),
  improvementSuggestions: z.array(z.string()).default([]),
  summary: z.string(),
  reviewedAt: z.string(),
});
export type StructuredReview = z.infer<typeof StructuredReviewSchema>;

// ============================================================================
// 5.1 — ExecutionRecord
// ============================================================================

export const ModelAssignmentSchema = z.object({
  provider: z.string(),
  model: z.string(),
  reason: z.string().optional(),
  score: z.number().optional(),
});
export type ModelAssignment = z.infer<typeof ModelAssignmentSchema>;

export const UserFeedbackEntrySchema = z.object({
  at: z.string(),
  text: z.string(),
  rating: z.number().min(1).max(5).optional(),
});
export type UserFeedbackEntry = z.infer<typeof UserFeedbackEntrySchema>;

export const ExecutionRecordSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  workspaceId: z.string(),
  agentRole: z.string(),                              // dynamic role, open string
  blueprintId: z.string().optional(),
  blueprintVersion: z.string().optional(),
  graphId: z.string().optional(),
  modelAssignment: ModelAssignmentSchema.optional(),
  artifacts: z.array(z.string()).default([]),
  review: StructuredReviewSchema.optional(),
  userFeedback: z.array(UserFeedbackEntrySchema).default([]),
  startedAt: z.string(),
  completedAt: z.string().optional(),
  durationMs: z.number().nonnegative().optional(),
  status: z.enum(["pending", "running", "completed", "failed"]).default("completed"),
  error: z.string().optional(),
});
export type ExecutionRecord = z.infer<typeof ExecutionRecordSchema>;

// ============================================================================
// 5.3 — FailureInsight
// ============================================================================

export const FailureInsightSchema = z.object({
  pattern: z.string(),
  frequency: z.number().int().nonnegative(),
  agentRoles: z.array(z.string()).default([]),
  providers: z.array(z.string()).default([]),
  models: z.array(z.string()).default([]),
  avgScore: z.number().min(0).max(10),
  examples: z.array(z.string()).default([]),          // executionIds
  firstSeen: z.string(),
  lastSeen: z.string(),
});
export type FailureInsight = z.infer<typeof FailureInsightSchema>;

export const LeaderboardInsightSchema = z.object({
  generatedAt: z.string(),
  totalExecutions: z.number().int().nonnegative(),
  worstRoles: z.array(z.object({
    role: z.string(),
    avgScore: z.number(),
    sampleSize: z.number().int().nonnegative(),
  })),
  worstModels: z.array(z.object({
    provider: z.string(),
    model: z.string(),
    avgScore: z.number(),
    sampleSize: z.number().int().nonnegative(),
  })),
});
export type LeaderboardInsight = z.infer<typeof LeaderboardInsightSchema>;

// ============================================================================
// 5.4 — EvolutionPlan
// ============================================================================

export const PlanChangeSchema = z.object({
  type: z.enum(["systemPrompt", "tools", "constraints", "preferredModels"]),
  from: z.string().optional(),
  to: z.string().optional(),
  reason: z.string(),
});
export type PlanChange = z.infer<typeof PlanChangeSchema>;

export const EvolutionPlanSchema = z.object({
  id: z.string(),
  agentRole: z.string(),
  fromVersion: z.string(),
  toVersion: z.string(),
  changes: z.array(PlanChangeSchema),
  expectedImprovement: z.object({
    score: z.number(),
    acceptance: z.number(),
  }),
  basedOn: z.object({
    executionCount: z.number().int().nonnegative(),
    avgScore: z.number(),
    acceptance: z.number(),
    topFailurePatterns: z.array(z.string()).default([]),
    topSuggestions: z.array(z.string()).default([]),
  }),
  createdAt: z.string(),
  status: z.enum(["draft", "applied", "abandoned"]).default("draft"),
});
export type EvolutionPlan = z.infer<typeof EvolutionPlanSchema>;

// ============================================================================
// 5.5 — CandidateVersion
// ============================================================================

export const CandidateVersionSchema = z.object({
  id: z.string(),                                       // bp-frontend-v2-xxx
  agentRole: z.string(),
  version: z.string(),                                  // "v2", "v3"
  parentBlueprintId: z.string(),
  parentVersion: z.string(),
  systemPrompt: z.string(),
  changes: z.array(PlanChangeSchema),
  generationReason: z.array(z.string()),
  planId: z.string().optional(),
  createdAt: z.string(),
  stats: z.object({
    totalRuns: z.number().int().nonnegative().default(0),
    avgScore: z.number().default(0),
    acceptance: z.number().default(0),
  }),
  status: z.enum(["candidate", "promoted", "rejected", "retired"]).default("candidate"),
  promotedAt: z.string().optional(),
  rejectedAt: z.string().optional(),
});
export type CandidateVersion = z.infer<typeof CandidateVersionSchema>;

// ============================================================================
// 5.6 — PromotionRecord
// ============================================================================

export const PromotionRecordSchema = z.object({
  id: z.string(),
  role: z.string(),
  fromVersion: z.string(),
  toVersion: z.string(),
  sampleSize: z.number().int().nonnegative(),
  oldAvgScore: z.number(),
  newAvgScore: z.number(),
  scoreGain: z.number(),                                // fraction (0.10 = 10%)
  oldAcceptance: z.number(),
  newAcceptance: z.number(),
  acceptanceGain: z.number(),
  promotedAt: z.string(),
  reason: z.string(),
  rule: z.object({
    minSample: z.number().int().nonnegative(),
    minScoreGain: z.number(),
    minAcceptanceGain: z.number(),
  }),
});
export type PromotionRecord = z.infer<typeof PromotionRecordSchema>;

// ============================================================================
// Defaults
// ============================================================================

export const DEFAULT_PROMOTION_CONFIG = {
  minSample: 20,
  minScoreGain: 0.10,
  minAcceptanceGain: 0.15,
};

export const DEFAULT_PLANNER_CONFIG = {
  minExecutions: 10,
  scoreThreshold: 6.0,
  acceptanceThreshold: 0.5,
  topFailureCount: 3,
};

export const PLANNER_CONFIG = DEFAULT_PLANNER_CONFIG;
export const PROMOTION_CONFIG = DEFAULT_PROMOTION_CONFIG;
