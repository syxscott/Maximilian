/**
 * DAGS core types.
 *
 * Six pieces:
 *   - Capability        (Stage 1) library entry
 *   - AgentBlueprint    (Stage 2) generated agent spec
 *   - TeamGraph         (Stage 4) DAG of nodes
 *   - ToolSpec          (Stage 2) tool description
 *   - ModelHint         (Stage 5) provider/model preference
 *   - Assignment        (Stage 5) resolved (provider, model) per node
 */

import { z } from "zod";

// ============================================================================
// Capability
// ============================================================================

export const CapabilityCategory = z.enum([
  "product",
  "frontend",
  "backend",
  "data",
  "devops",
  "testing",
  "research",
  "writing",
  "review",
  "general",
]);
export type CapabilityCategory = z.infer<typeof CapabilityCategory>;

export const CapabilitySchema = z.object({
  id: z.string(),
  displayName: z.string(),
  description: z.string(),
  category: CapabilityCategory,
  keywords: z.array(z.string()).default([]),
  defaultGoal: z.string(),
  promptTemplate: z.string(),
  defaultTools: z.array(z.string()).default([]),
  defaultConstraints: z
    .object({
      outputFormat: z.enum(["code", "json", "markdown", "free"]).default("free"),
      maxTokens: z.number().int().positive().optional(),
      temperature: z.number().min(0).max(2).optional(),
      mustIncludeCodeBlocks: z.boolean().optional(),
    })
    .default({ outputFormat: "free" }),
  dependsOn: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
});
export type Capability = z.infer<typeof CapabilitySchema>;

// ============================================================================
// Tool
// ============================================================================

export const ToolSpecSchema = z.object({
  name: z.string(),
  description: z.string(),
  parameters: z.record(z.unknown()).optional(),
  resourceBudget: z
    .object({
      vramMb: z.number().int().positive().optional(),
      exclusive: z.boolean().optional(),
    })
    .optional(),
});
export type ToolSpec = z.infer<typeof ToolSpecSchema>;

// ============================================================================
// Model Hint
// ============================================================================

export const ModelHintSchema = z.object({
  provider: z.string(),
  model: z.string(),
  reason: z.string(),
});
export type ModelHint = z.infer<typeof ModelHintSchema>;

// ============================================================================
// AgentBlueprint
// ============================================================================

export const AgentBlueprintSchema = z.object({
  id: z.string(),
  role: z.string(),                                    // logical role name
  displayName: z.string(),
  goal: z.string(),
  systemPrompt: z.string(),
  capabilities: z.array(z.string()).default([]),
  tools: z.array(ToolSpecSchema).default([]),
  preferredModels: z.array(ModelHintSchema).default([]),
  constraints: z
    .object({
      outputFormat: z.enum(["code", "json", "markdown", "free"]).default("free"),
      maxTokens: z.number().int().positive().optional(),
      temperature: z.number().min(0).max(2).optional(),
      mustIncludeCodeBlocks: z.boolean().optional(),
    })
    .default({ outputFormat: "free" }),
  version: z.string().default("v1"),
  parentId: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  retiredAt: z.string().optional(),
  stats: z
    .object({
      totalTasks: z.number().int().nonnegative().default(0),
      totalSuccesses: z.number().int().nonnegative().default(0),
      avgScore: z.number().min(0).max(10).default(0),
      avgExecutionTimeMs: z.number().nonnegative().default(0),
      lastUsedAt: z.string().optional(),
    })
    .default({ totalTasks: 0, totalSuccesses: 0, avgScore: 0, avgExecutionTimeMs: 0 }),
  metadata: z.record(z.unknown()).default({}),
});
export type AgentBlueprint = z.infer<typeof AgentBlueprintSchema>;

// ============================================================================
// Team Graph
// ============================================================================

export const TeamNodeSchema = z.object({
  id: z.string(),
  kind: z.enum(["agent", "approval"]).default("agent"),
  blueprintId: z.string().optional(),
  role: z.string(),
  displayName: z.string(),
  dependsOn: z.array(z.string()).default([]),
  approvalConfig: z
    .object({
      prompt: z.string(),
      requireComment: z.boolean().default(false),
      reason: z.string().optional(),
    })
    .optional(),
  modelAssignment: z
    .object({
      provider: z.string(),
      model: z.string(),
      reason: z.string(),
      score: z.number(),
    })
    .optional(),
});
export type TeamNode = z.infer<typeof TeamNodeSchema>;

export const TeamEdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  type: z.enum(["data_flow", "review", "validation"]).default("data_flow"),
  description: z.string().optional(),
});
export type TeamEdge = z.infer<typeof TeamEdgeSchema>;

export const TeamLayerSchema = z.object({
  index: z.number().int().nonnegative(),
  nodeIds: z.array(z.string()),
});
export type TeamLayer = z.infer<typeof TeamLayerSchema>;

export const TeamGraphStatus = z.enum(["draft", "ready", "executing", "completed", "failed"]);
export type TeamGraphStatus = z.infer<typeof TeamGraphStatus>;

export const TeamGraphSchema = z.object({
  id: z.string(),
  userRequest: z.string(),
  capabilities: z.array(z.string()),
  nodes: z.array(TeamNodeSchema),
  edges: z.array(TeamEdgeSchema).default([]),
  layers: z.array(TeamLayerSchema).default([]),
  createdAt: z.string(),
  status: TeamGraphStatus.default("draft"),
});
export type TeamGraph = z.infer<typeof TeamGraphSchema>;

// ============================================================================
// Helpers
// ============================================================================

export function emptyStats() {
  return {
    totalTasks: 0,
    totalSuccesses: 0,
    avgScore: 0,
    avgExecutionTimeMs: 0,
  };
}
