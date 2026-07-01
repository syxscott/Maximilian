/**
 * Phase 6 — Meta-System core types.
 *
 *   CapabilityRecord      6.2 — capability lifecycle (proposed → ... → retired)
 *   CapabilityProposal    6.1 — what the discovery engine found
 *   AgentChangePlan       6.3 — meta-agent decisions (create/delete/merge/split)
 *   OrganizationEvent     6.7 — append-only org history
 *   GovernanceConfig      6.9 — limits
 *   SimulationResult      6.8 — predicted cost/latency/quality
 *   TeamOptimizerHint     6.4 — suggested team adjustments
 */

import { z } from "zod";

// ============================================================================
// 6.1 — CapabilityProposal
// ============================================================================

export const ProposalSourceSchema = z.enum([
  "user_request_analysis",
  "failure_pattern_mining",
  "review_suggestion",
  "capability_gap",
]);
export type ProposalSource = z.infer<typeof ProposalSourceSchema>;

export const CapabilityProposalSchema = z.object({
  id: z.string(),
  capabilityId: z.string(),
  displayName: z.string(),
  rationale: z.string(),
  source: ProposalSourceSchema,
  evidence: z.array(z.string()).default([]),
  proposedAt: z.string(),
});
export type CapabilityProposal = z.infer<typeof CapabilityProposalSchema>;

// ============================================================================
// 6.2 — CapabilityRecord (Lifecycle)
// ============================================================================

export const CapabilityStatusSchema = z.enum([
  "proposed",
  "experimental",
  "active",
  "deprecated",
  "retired",
]);
export type CapabilityStatus = z.infer<typeof CapabilityStatusSchema>;

export const CapabilityRecordSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  description: z.string().default(""),
  status: CapabilityStatusSchema,
  proposalId: z.string().optional(),
  promotedAt: z.string().optional(),
  retiredAt: z.string().optional(),
  usageCount: z.number().int().nonnegative().default(0),
  totalExecutions: z.number().int().nonnegative().default(0),
  avgScore: z.number().min(0).max(10).default(0),
  avgDurationMs: z.number().nonnegative().default(0),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CapabilityRecord = z.infer<typeof CapabilityRecordSchema>;

// ============================================================================
// 6.3 — AgentChangePlan
// ============================================================================

export const ChangeActionSchema = z.enum([
  "create",
  "delete",
  "merge",
  "split",
]);
export type ChangeAction = z.infer<typeof ChangeActionSchema>;

export const AgentChangeSchema = z.object({
  action: ChangeActionSchema,
  agentRole: z.string(),
  targetRole: z.string().optional(),  // for merge/split
  reason: z.string(),
});
export type AgentChange = z.infer<typeof AgentChangeSchema>;

export const AgentChangePlanSchema = z.object({
  id: z.string(),
  decisions: z.array(AgentChangeSchema),
  expectedImpact: z.object({
    costDelta: z.number(),
    latencyDeltaMs: z.number(),
    qualityDelta: z.number(),
  }),
  rationale: z.string(),
  createdAt: z.string(),
  status: z.enum(["draft", "approved", "rejected", "applied"]).default("draft"),
});
export type AgentChangePlan = z.infer<typeof AgentChangePlanSchema>;

// ============================================================================
// 6.4 — TeamOptimizerHint
// ============================================================================

export const TeamOptimizerHintSchema = z.object({
  id: z.string(),
  suggestions: z.array(z.object({
    type: z.enum(["add_review_node", "parallelize", "shrink_team", "grow_team", "remove_redundant"]),
    targetRole: z.string().optional(),
    rationale: z.string(),
    expectedCostDelta: z.number(),
    expectedLatencyDeltaMs: z.number(),
  })),
  estimatedCost: z.number(),
  estimatedLatencyMs: z.number(),
  estimatedQuality: z.number().min(0).max(10),
  createdAt: z.string(),
});
export type TeamOptimizerHint = z.infer<typeof TeamOptimizerHintSchema>;

// ============================================================================
// 6.5 — AgentBirthResult
// ============================================================================

export const AgentBirthResultSchema = z.object({
  blueprintId: z.string(),
  role: z.string(),
  displayName: z.string(),
  systemPrompt: z.string(),
  capabilities: z.array(z.string()),
  constraints: z.object({
    outputFormat: z.enum(["code", "json", "markdown", "free"]),
    maxTokens: z.number().optional(),
    temperature: z.number().optional(),
  }),
  version: z.string().default("v1"),
  parentCapability: z.string(),
  createdAt: z.string(),
});
export type AgentBirthResult = z.infer<typeof AgentBirthResultSchema>;

// ============================================================================
// 6.6 — RetirementDecision
// ============================================================================

export const RetirementReasonSchema = z.enum([
  "low_usage",
  "low_score",
  "replaced_by_newer",
  "capability_retired",
  "manual",
]);
export type RetirementReason = z.infer<typeof RetirementReasonSchema>;

export const RetirementDecisionSchema = z.object({
  blueprintId: z.string(),
  role: z.string(),
  reason: RetirementReasonSchema,
  metrics: z.object({
    usageCount: z.number(),
    avgScore: z.number(),
    sampleSize: z.number(),
  }),
  decidedAt: z.string(),
});
export type RetirementDecision = z.infer<typeof RetirementDecisionSchema>;

// ============================================================================
// 6.7 — OrganizationEvent
// ============================================================================

export const OrgEventTypeSchema = z.enum([
  "capability_proposed",
  "capability_promoted",
  "capability_deprecated",
  "capability_retired",
  "agent_born",
  "agent_retired",
  "agent_merged",
  "agent_split",
  "team_optimized",
  "governance_violation",
  "proposal_rejected_by_human",
  "proposal_approved_by_human",
]);
export type OrgEventType = z.infer<typeof OrgEventTypeSchema>;

export const OrganizationEventSchema = z.object({
  id: z.string(),
  type: OrgEventTypeSchema,
  subject: z.string(),  // capabilityId or blueprintId
  payload: z.record(z.unknown()).default({}),
  at: z.string(),
});
export type OrganizationEvent = z.infer<typeof OrganizationEventSchema>;

// ============================================================================
// 6.8 — SimulationResult
// ============================================================================

export const SimulationResultSchema = z.object({
  orgName: z.string(),
  teamSize: z.number(),
  totalEstimatedCost: z.number(),
  totalEstimatedLatencyMs: z.number(),
  estimatedAvgQuality: z.number().min(0).max(10),
  riskScore: z.number().min(0).max(1),
  comparedWith: z.string().optional(),
  simulatedAt: z.string(),
});
export type SimulationResult = z.infer<typeof SimulationResultSchema>;

// ============================================================================
// 6.9 — GovernanceConfig
// ============================================================================

export const GovernanceConfigSchema = z.object({
  maxAgents: z.number().int().positive(),
  maxCapabilities: z.number().int().positive(),
  maxDepth: z.number().int().positive(),
  requireReviewForBirth: z.boolean().default(true),
  minUsageForBirth: z.number().int().nonnegative().default(0),
  /** Phase 11 — riskPenalty threshold above which proposals require human approval. */
  hitlRiskThreshold: z.number().min(0).max(1).default(0.4),
  /** Phase 11 — proposal actions that always require human approval. */
  hitlAlwaysForActions: z.array(z.string()).default(["retire"]),
});
export type GovernanceConfig = z.infer<typeof GovernanceConfigSchema>;

export const DEFAULT_GOVERNANCE_CONFIG: GovernanceConfig = {
  maxAgents: 20,
  maxCapabilities: 30,
  maxDepth: 4,
  requireReviewForBirth: true,
  minUsageForBirth: 0,
  hitlRiskThreshold: 0.4,
  hitlAlwaysForActions: ["retire"],
};

export const GovernanceVerdictSchema = z.object({
  allowed: z.boolean(),
  reason: z.string(),
  currentCounts: z.object({
    agents: z.number(),
    capabilities: z.number(),
    depth: z.number(),
  }),
  /** Phase 11 — HITL status. "pending_human" means paused for human review. */
  status: z.enum(["approved", "blocked", "pending_human"]).default("approved"),
});
export type GovernanceVerdict = z.infer<typeof GovernanceVerdictSchema>;

// ============================================================================
// Defaults
// ============================================================================

export const RETIREMENT_THRESHOLDS = {
  lookback: 100,
  minUsageToKeep: 2,
  minScoreToKeep: 4.0,
};

export const DISCOVERY_CONFIG = {
  minFrequency: 2,
  minFailureRate: 0.3,
  minReviewOccurrences: 3,
};

export const TEAM_OPTIMIZER_CONFIG = {
  minRedundancyThreshold: 0.8,
  minLatencyToShrinkMs: 30000,
  minQualityToGrow: 7.5,
};

// ============================================================================
// Phase 8 — Digital Twin & Safe Evolution
// ============================================================================

// 8.2 — OrganizationSnapshot (Digital Twin)
export const OrganizationSnapshotSchema = z.object({
  id: z.string(),
  capturedAt: z.string(),
  capabilities: z.array(CapabilityRecordSchema),
  blueprints: z.array(z.record(z.unknown())),
  graphs: z.array(z.record(z.unknown())),
  leaderboards: z.record(z.unknown()),
});
export type OrganizationSnapshot = z.infer<typeof OrganizationSnapshotSchema>;

// 8.3 — Proposal (unified mutation request)
export const ProposalActionSchema = z.enum([
  "birth",
  "retire",
  "promote",
  "demote",
  "merge",
  "split",
  "rebalance_team",
]);
export type ProposalAction = z.infer<typeof ProposalActionSchema>;

export const ProposalSourceEnumSchema = z.enum([
  "meta_agent",
  "team_optimizer",
  "evolution_planner",
  "manual",
]);
export type ProposalSourceEnum = z.infer<typeof ProposalSourceEnumSchema>;

export const ProposalStatusSchema = z.enum([
  "draft",
  "simulating",
  "simulated",
  "approved",
  "rejected",
  "rolling_out",
  "applied",
  "failed",
  "pending_human",
]);
export type ProposalStatus = z.infer<typeof ProposalStatusSchema>;

export const ProposalSchema = z.object({
  id: z.string(),
  action: ProposalActionSchema,
  subject: z.string(),
  target: z.string().optional(),
  rationale: z.string(),
  payload: z.record(z.unknown()).default({}),
  status: ProposalStatusSchema.default("draft"),
  source: ProposalSourceEnumSchema,
  createdAt: z.string(),
});
export type Proposal = z.infer<typeof ProposalSchema>;

// 8.1 — SimulationDelta (output of simulateDelta)
export const SimulationDeltaSchema = z.object({
  costDelta: z.number(),
  latencyDeltaMs: z.number(),
  qualityDelta: z.number(),
  riskDelta: z.number(),
  before: SimulationResultSchema.optional(),
  after: SimulationResultSchema.optional(),
  simulatedAt: z.string(),
});
export type SimulationDelta = z.infer<typeof SimulationDeltaSchema>;

// 8.4 — RolloutMode (shadow / canary / full)
export const RolloutModeSchema = z.enum(["shadow", "canary", "full"]);
export type RolloutMode = z.infer<typeof RolloutModeSchema>;

export const ROLLOUT_CONFIG = {
  defaultMode: "shadow" as RolloutMode,
  canaryFraction: 0.1,
  utilityThreshold: 0.0,
};

// 8.5 — DecisionScore (utility formula)
export const DecisionScoreSchema = z.object({
  proposalId: z.string(),
  qualityGain: z.number(),
  latencyPenalty: z.number(),
  costPenalty: z.number(),
  riskPenalty: z.number(),
  utility: z.number(),
  approved: z.boolean(),
  reason: z.string(),
});
export type DecisionScore = z.infer<typeof DecisionScoreSchema>;

export const DECISION_SCORING_CONFIG = {
  costWeight: 1.0,
  latencyWeight: 0.001,
  riskWeight: 10.0,
  qualityWeight: 1.0,
  utilityThreshold: 0.0,
};

// 8.6 — ReplayOutcome
export const ReplayOutcomeSchema = z.object({
  proposalId: z.string(),
  baselineQuality: z.number(),
  simulatedQuality: z.number(),
  qualityDelta: z.number(),
  affectedExecutions: z.number(),
  at: z.string(),
});
export type ReplayOutcome = z.infer<typeof ReplayOutcomeSchema>;

// ============================================================================
// Phase 10 — TelemetrySink (inline interface, avoids @max/telemetry dependency)
// ============================================================================

/**
 * Structural match for @max/telemetry TelemetryCollector.recordEvolution().
 * Defined here to avoid adding a hard dependency on @max/telemetry.
 * TypeScript structural typing ensures TelemetryCollector satisfies this.
 */
export interface TelemetrySink {
  recordEvolution(input: {
    proposalId: string;
    proposalType: string;
    subject: string;
    snapshotId?: string;
    simulatedScores: {
      costDelta: number;
      latencyDeltaMs: number;
      qualityDelta: number;
      riskDelta: number;
      utility: number;
    };
    governanceVerdict: { allowed: boolean; reason: string };
    rolloutStatus: string;
    approved: boolean;
  }): Promise<unknown>;
}

// ============================================================================
// Phase 11 — PendingProposal (HITL gate)
// ============================================================================

export const PendingProposalSchema = z.object({
  proposalId: z.string(),
  proposal: ProposalSchema,
  simulation: SimulationDeltaSchema,
  score: DecisionScoreSchema,
  snapshotId: z.string().optional(),
  status: z.enum(["pending_human", "approved", "rejected"]).default("pending_human"),
  requestedAt: z.string(),
  resolvedAt: z.string().optional(),
  resolvedBy: z.string().optional(),
  resolutionReason: z.string().optional(),
});
export type PendingProposal = z.infer<typeof PendingProposalSchema>;
