/**
 * Core data structures.
 *
 * These are the canonical schemas exchanged between Commander, Agents,
 * Workspace, and UI. Use zod to validate at runtime.
 */

import { z } from "zod";

// ============================================================================
// Task Status
// ============================================================================

export const TaskStatus = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
  "skipped",
]);
export type TaskStatus = z.infer<typeof TaskStatus>;

// ============================================================================
// Agent Manifest (logical role, not runtime instance)
// ============================================================================

export const AgentRole = z.enum([
  "frontend",
  "backend",
  "review",
  "general",
]);
export type AgentRole = z.infer<typeof AgentRole>;

export const AgentManifestSchema = z.object({
  role: AgentRole,
  displayName: z.string(),
  goal: z.string(),
  systemPrompt: z.string(),
  modelProviderId: z.string().optional(),
  modelName: z.string().optional(),
  /**
   * Per-agent tool allowlist (借鉴 cc-switch OpenClawToolsConfig).
   * When set, the agent is restricted to using only these tools.
   * Empty/undefined = no restriction (all registered tools are available).
   *
   * Tools NOT in this list are filtered out from the tool definitions
   * sent to the LLM, so the model never even sees tools it shouldn't call.
   * This is a static gate (always enforced) — distinct from the runtime
   * permission gate (approval-based, per-call).
   */
  allowedTools: z.array(z.string()).optional(),
  /**
   * Per-agent tool denylist (借鉴 cc-switch).
   * Tools in this list are removed from the available set, even if they
   * match the allowlist. Denylist wins over allowlist.
   */
  deniedTools: z.array(z.string()).optional(),
});
export type AgentManifest = z.infer<typeof AgentManifestSchema>;

// ============================================================================
// Task
// ============================================================================

export const TaskSchema = z.object({
  id: z.string(),
  agentRole: AgentRole,
  description: z.string(),
  status: TaskStatus.default("pending"),
  dependsOn: z.array(z.string()).default([]),
  resultId: z.string().optional(),
  error: z.string().optional(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type Task = z.infer<typeof TaskSchema>;

// ============================================================================
// Result (Agent output)
// ============================================================================

export const ResultSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  agentRole: AgentRole,
  agentId: z.string(),
  output: z.string(),
  metadata: z.record(z.unknown()).default({}),
  createdAt: z.string(),
  durationMs: z.number().optional(),
});
export type Result = z.infer<typeof ResultSchema>;

// ============================================================================
// Plan
// ============================================================================

export const PlanSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  userRequest: z.string(),
  rationale: z.string().default(""),
  tasks: z.array(TaskSchema),
  createdAt: z.string(),
});
export type Plan = z.infer<typeof PlanSchema>;

// ============================================================================
// Review Result
// ============================================================================

export const ReviewResultSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  planId: z.string(),
  score: z.number().min(0).max(10),
  issues: z.array(z.string()),
  suggestions: z.array(z.string()),
  summary: z.string(),
  reviewedAt: z.string(),
});
export type ReviewResult = z.infer<typeof ReviewResultSchema>;

// ============================================================================
// Workspace (top-level container for one user request)
// ============================================================================

export const WorkspaceStatus = z.enum([
  "planning",
  "executing",
  "reviewing",
  "completed",
  "failed",
]);
export type WorkspaceStatus = z.infer<typeof WorkspaceStatus>;

export const WorkspaceSchema = z.object({
  id: z.string(),
  userRequest: z.string(),
  status: WorkspaceStatus,
  plan: PlanSchema.optional(),
  results: z.array(ResultSchema).default([]),
  review: ReviewResultSchema.optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  error: z.string().optional(),
  /**
   * Free-form metadata bag for cross-cutting context that doesn't belong
   * on the typed schema. Used today to carry `tenantId` from the chat
   * route into the runtime sink without expanding the RuntimeSink
   * interface. NOT a substitute for typed fields — keep keys documented.
   */
  metadata: z.record(z.unknown()).default({}),
});
export type Workspace = z.infer<typeof WorkspaceSchema>;

// ============================================================================
// Agent (runtime instance)
// ============================================================================

export const AgentInstanceSchema = z.object({
  id: z.string(),
  manifest: AgentManifestSchema,
  status: z.enum(["idle", "busy", "completed", "failed"]),
  currentTaskId: z.string().optional(),
  createdAt: z.string(),
});
export type AgentInstance = z.infer<typeof AgentInstanceSchema>;

// ============================================================================
// Channel Values (checkpoint state)
// ============================================================================

/**
 * Arbitrary key-value map representing the state of all channels at a
 * checkpoint. Mirrors LangGraph's ChannelValues.
 */
export type ChannelValues = Record<string, unknown>;

/**
 * Free-form config dict used to query/checkpoint stores.
 * The only required key is `thread_id` (the workspace id).
 * Additional keys (e.g. `checkpoint_id`) are used for specific lookups.
 */
export type ConfigurableDict = Record<string, string | number | boolean | null | undefined>;

// ============================================================================
// Task Priority (task re-ranking)
// ============================================================================

/**
 * Result of LLM-based task re-ranking (借鉴 AutoGPT TaskPrioritizer).
 * Returned by TaskPrioritizer.reRank() and used by the runtime to
 * reorder the remaining task list.
 */
export interface TaskPriority {
  taskId: string;
  priority: "high" | "medium" | "low";
  /** Optional revised scope/description for the task. */
  newScope?: string;
}

// ============================================================================
// JSON Schemas (for OpenAPI / documentation)
// ============================================================================

export const JSON_SCHEMAS = {
  Plan: {
    type: "object",
    properties: {
      id: { type: "string" },
      workspaceId: { type: "string" },
      userRequest: { type: "string" },
      rationale: { type: "string" },
      tasks: { type: "array", items: { $ref: "#/components/schemas/Task" } },
      createdAt: { type: "string", format: "date-time" },
    },
    required: ["id", "workspaceId", "userRequest", "tasks", "createdAt"],
  },
  Task: {
    type: "object",
    properties: {
      id: { type: "string" },
      agentRole: { type: "string", enum: ["frontend", "backend", "review", "general"] },
      description: { type: "string" },
      status: { type: "string", enum: ["pending", "running", "completed", "failed"] },
      dependsOn: { type: "array", items: { type: "string" } },
    },
    required: ["id", "agentRole", "description", "status"],
  },
  Agent: {
    type: "object",
    properties: {
      id: { type: "string" },
      role: { type: "string" },
      goal: { type: "string" },
      status: { type: "string" },
    },
    required: ["id", "role", "goal", "status"],
  },
  Result: {
    type: "object",
    properties: {
      id: { type: "string" },
      taskId: { type: "string" },
      agentId: { type: "string" },
      output: { type: "string" },
      createdAt: { type: "string", format: "date-time" },
    },
    required: ["id", "taskId", "agentId", "output", "createdAt"],
  },
  ReviewResult: {
    type: "object",
    properties: {
      id: { type: "string" },
      score: { type: "number", minimum: 0, maximum: 10 },
      issues: { type: "array", items: { type: "string" } },
      suggestions: { type: "array", items: { type: "string" } },
      summary: { type: "string" },
    },
    required: ["id", "score", "issues", "suggestions", "summary"],
  },
};