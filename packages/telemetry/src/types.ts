/**
 * Phase 10 — Telemetry Core Types.
 *
 * Zod schemas for execution traces (user request lifecycle) and
 * evolution traces (meta-system self-evolution events).
 * Self-contained — no imports from other @max/ packages.
 */

import { z } from "zod";

// ============================================================================
// ExecutionTrace — 追踪单个用户请求流经 DAGS/AgentRuntime 的全生命周期
// ============================================================================

export const AgentMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string(),
  agentRole: z.string(),
  taskId: z.string(),
  timestamp: z.string(),
});
export type AgentMessage = z.infer<typeof AgentMessageSchema>;

export const TeamGraphNodeSchema = z.object({
  id: z.string(),
  role: z.string(),
  displayName: z.string(),
  dependsOn: z.array(z.string()).default([]),
});
export type TeamGraphNode = z.infer<typeof TeamGraphNodeSchema>;

export const AssignedTeamGraphSchema = z.object({
  id: z.string(),
  nodes: z.array(TeamGraphNodeSchema),
  capabilities: z.array(z.string()),
});
export type AssignedTeamGraph = z.infer<typeof AssignedTeamGraphSchema>;

export const ExecutionTraceSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  taskId: z.string(),
  userPrompt: z.string(),
  assignedTeamGraph: AssignedTeamGraphSchema,
  steps: z.array(AgentMessageSchema),
  status: z.enum(["running", "completed", "failed"]),
  startedAt: z.string(),
  completedAt: z.string().optional(),
  error: z.string().optional(),
});
export type ExecutionTrace = z.infer<typeof ExecutionTraceSchema>;

// ============================================================================
// EvolutionTrace — 追踪 Meta-System 自进化事件
// ============================================================================

export const ProposalTypeSchema = z.enum([
  "birth",
  "retire",
  "promote",
  "demote",
  "merge",
  "split",
  "rebalance_team",
]);
export type ProposalType = z.infer<typeof ProposalTypeSchema>;

export const SimulatedScoresSchema = z.object({
  costDelta: z.number(),
  latencyDeltaMs: z.number(),
  qualityDelta: z.number(),
  riskDelta: z.number(),
  utility: z.number(),
});
export type SimulatedScores = z.infer<typeof SimulatedScoresSchema>;

export const GovernanceVerdictSchema = z.object({
  allowed: z.boolean(),
  reason: z.string(),
});
export type GovernanceVerdict = z.infer<typeof GovernanceVerdictSchema>;

export const RolloutStatusSchema = z.enum([
  "shadow",
  "canary",
  "full",
  "applied",
  "skipped",
]);
export type RolloutStatus = z.infer<typeof RolloutStatusSchema>;

export const EvolutionTraceSchema = z.object({
  id: z.string(),
  proposalId: z.string(),
  proposalType: ProposalTypeSchema,
  subject: z.string(),
  snapshotId: z.string().optional(),
  simulatedScores: SimulatedScoresSchema,
  governanceVerdict: GovernanceVerdictSchema,
  rolloutStatus: RolloutStatusSchema,
  approved: z.boolean(),
  recordedAt: z.string(),
});
export type EvolutionTrace = z.infer<typeof EvolutionTraceSchema>;

// ============================================================================
// TelemetryConfig — Collector 配置
// ============================================================================

export const TelemetryConfigSchema = z.object({
  /** 内存 ring-buffer 每类别的最大条目数 */
  maxBufferSize: z.number().int().positive().default(1000),
  /** 可选：持久化到 JSONL 文件的路径 */
  persistPath: z.string().optional(),
});
export type TelemetryConfig = z.infer<typeof TelemetryConfigSchema>;
