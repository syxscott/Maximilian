import { pgTable, text, timestamp, jsonb, integer, numeric, boolean, uniqueIndex, real } from "drizzle-orm/pg-core";

// ── Tenants ─────────────────────────────────────────────────────────────────

export const tenants = pgTable("tenants", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").unique().notNull(),
  plan: text("plan").default("free").notNull(), // free | pro | enterprise
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// ── Workspaces ──────────────────────────────────────────────────────────────

export const workspaces = pgTable("workspaces", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
  userRequest: text("user_request").notNull(),
  status: text("status").notNull(), // planning | executing | reviewing | completed | failed
  plan: jsonb("plan"),              // Plan object or null
  results: jsonb("results").default([]).notNull(),
  review: jsonb("review"),          // ReviewResult or null
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// ── Workspace Artifacts ─────────────────────────────────────────────────────

export const workspaceArtifacts = pgTable(
  "workspace_artifacts",
  {
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    content: text("content").notNull(),
  },
  (table) => ({
    uniqWorkspaceFilename: uniqueIndex("workspace_artifacts_workspace_filename_uq").on(
      table.workspaceId,
      table.filename,
    ),
  }),
);

// ── Metrics ─────────────────────────────────────────────────────────────────

export const metrics = pgTable("metrics", {
  taskId: text("task_id").primaryKey(),
  tenantId: text("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
  agentId: text("agent_id").notNull(),
  agentRole: text("agent_role").notNull(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  executionTime: numeric("execution_time").notNull(),
  tokenInput: integer("token_input").notNull(),
  tokenOutput: integer("token_output").notNull(),
  /** Tokens served from provider-side prompt cache (Anthropic cache_read_input_tokens,
   *  OpenAI prompt_tokens_details.cached_tokens). 0 when not reported. */
  cacheReadTokens: integer("cache_read_tokens").default(0).notNull(),
  /** Tokens written into provider-side cache (Anthropic cache_creation_input_tokens).
   *  Always 0 for OpenAI-style protocols. */
  cacheCreationTokens: integer("cache_creation_tokens").default(0).notNull(),
  reviewScore: numeric("review_score"),
  userAccepted: boolean("user_accepted"),
  retryCount: integer("retry_count").default(0).notNull(),
  error: text("error"),
  timestamp: text("timestamp").notNull(), // ISO string
});

// ── Executions ──────────────────────────────────────────────────────────────

export const executions = pgTable("executions", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
  taskId: text("task_id").notNull(),
  workspaceId: text("workspace_id").notNull(),
  agentRole: text("agent_role").notNull(),
  blueprintId: text("blueprint_id"),
  blueprintVersion: text("blueprint_version"),
  graphId: text("graph_id"),
  modelAssignment: jsonb("model_assignment"),
  artifacts: jsonb("artifacts").default([]).notNull(),
  review: jsonb("review"),
  userFeedback: jsonb("user_feedback").default([]).notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  durationMs: numeric("duration_ms"),
  status: text("status").default("completed").notNull(), // pending | running | completed | failed
  error: text("error"),
});

// ── Organization Events ─────────────────────────────────────────────────────

export const orgEvents = pgTable("org_events", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  subject: text("subject").notNull(),
  payload: jsonb("payload").default({}).notNull(),
  at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
});

// ── Users ───────────────────────────────────────────────────────────────────

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
  email: text("email").unique().notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").default("viewer").notNull(), // admin | operator | viewer
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// ── Refresh Tokens ──────────────────────────────────────────────────────────

export const refreshTokens = pgTable("refresh_tokens", {
  id: text("id").primaryKey(),
  jti: text("jti").unique().notNull(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revoked: boolean("revoked").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ── Agent Profiles (Phase 2 — Evolution) ────────────────────────────────────

export const agentProfiles = pgTable("agent_profiles", {
  id: text("id").primaryKey(),          // equals role
  role: text("role").notNull().unique(),
  createdAt: text("created_at").notNull(),
  totalTasks: integer("total_tasks").default(0).notNull(),
  avgScore: real("avg_score").default(0).notNull(),
  successRate: real("success_rate").default(1).notNull(),
  avgExecutionTime: real("avg_execution_time").default(0).notNull(),
  preferredModel: text("preferred_model"),
  strengths: jsonb("strengths").default([]).notNull(),
  weaknesses: jsonb("weaknesses").default([]).notNull(),
  memory: jsonb("memory").default({}).notNull(),
  currentVersion: text("current_version").default("v1").notNull(),
  versions: jsonb("versions").default(["v1"]).notNull(),
  manifest: jsonb("manifest"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// ── Agent Versions (Phase 6 — Evolution) ─────────────────────────────────────

export const agentVersions = pgTable("agent_versions", {
  id: text("id").primaryKey(),                   // e.g. "v1"
  agentRole: text("agent_role").notNull(),
  manifest: jsonb("manifest").notNull(),
  createdAt: text("created_at").notNull(),
  retiredAt: text("retired_at"),
  reason: text("reason").default("initial").notNull(),
  stats: jsonb("stats").default({}).notNull(),
});

// ── Evolution Decisions (Phase 6 — Evolution) ────────────────────────────────

export const evolutionDecisions = pgTable("evolution_decisions", {
  id: text("id").primaryKey(),
  agentRole: text("agent_role").notNull(),
  fromVersion: text("from_version").notNull(),
  toVersion: text("to_version").notNull(),
  outcome: text("outcome").notNull(),              // promoted | discarded
  oldAvgScore: real("old_avg_score").notNull(),
  newAvgScore: real("new_avg_score").notNull(),
  triggeredAt: text("triggered_at").notNull(),
  reason: text("reason").notNull(),
});

// ── Failure Insights (Phase 5 — Autonomy) ────────────────────────────────────

export const failureInsights = pgTable("failure_insights", {
  id: text("id").primaryKey(),
  pattern: text("pattern").notNull(),
  frequency: integer("frequency").notNull(),
  agentRoles: jsonb("agent_roles").default([]).notNull(),
  providers: jsonb("providers").default([]).notNull(),
  models: jsonb("models").default([]).notNull(),
  avgScore: real("avg_score").notNull(),
  examples: jsonb("examples").default([]).notNull(),
  firstSeen: text("first_seen").notNull(),
  lastSeen: text("last_seen").notNull(),
});

// ── Leaderboard Insights (Phase 5 — Autonomy) ───────────────────────────────

export const leaderboardInsights = pgTable("leaderboard_insights", {
  id: text("id").primaryKey().default("singleton"),
  generatedAt: text("generated_at").notNull(),
  totalExecutions: integer("total_executions").notNull(),
  worstRoles: jsonb("worst_roles").default([]).notNull(),
  worstModels: jsonb("worst_models").default([]).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// ── Blueprints (DAGS) ───────────────────────────────────────────────────────

export const blueprints = pgTable("blueprints", {
  id: text("id").primaryKey(),
  role: text("role").notNull(),
  displayName: text("display_name").notNull(),
  goal: text("goal").notNull(),
  systemPrompt: text("system_prompt").notNull(),
  capabilities: jsonb("capabilities").default([]).notNull(),
  tools: jsonb("tools").default([]).notNull(),
  preferredModels: jsonb("preferred_models").default([]).notNull(),
  constraints: jsonb("constraints").default({}).notNull(),
  version: text("version").default("v1").notNull(),
  parentId: text("parent_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  retiredAt: text("retired_at"),
  stats: jsonb("stats").default({}).notNull(),
  metadata: jsonb("metadata").default({}).notNull(),
});

// ── Team Graphs (DAGS) ──────────────────────────────────────────────────────

export const teamGraphs = pgTable("team_graphs", {
  id: text("id").primaryKey(),
  userRequest: text("user_request").notNull(),
  capabilities: jsonb("capabilities").default([]).notNull(),
  nodes: jsonb("nodes").default([]).notNull(),
  edges: jsonb("edges").default([]).notNull(),
  layers: jsonb("layers").default([]).notNull(),
  createdAt: text("created_at").notNull(),
  status: text("status").default("draft").notNull(),
});

// ── Capabilities (Phase 6.2 — Meta-System) ──────────────────────────────────

export const capabilities = pgTable("capabilities", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  description: text("description").default("").notNull(),
  status: text("status").notNull(),                // proposed | experimental | active | deprecated | retired
  proposalId: text("proposal_id"),
  promotedAt: text("promoted_at"),
  retiredAt: text("retired_at"),
  usageCount: integer("usage_count").default(0).notNull(),
  totalExecutions: integer("total_executions").default(0).notNull(),
  avgScore: real("avg_score").default(0).notNull(),
  avgDurationMs: real("avg_duration_ms").default(0).notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// ── Governance Config (Phase 6.9 — Meta-System) ─────────────────────────────

export const governanceConfig = pgTable("governance_config", {
  id: text("id").primaryKey().default("singleton"),
  maxAgents: integer("max_agents").notNull(),
  maxCapabilities: integer("max_capabilities").notNull(),
  maxDepth: integer("max_depth").notNull(),
  requireReviewForBirth: boolean("require_review_for_birth").default(true).notNull(),
  minUsageForBirth: integer("min_usage_for_birth").default(0).notNull(),
  hitlRiskThreshold: real("hitl_risk_threshold").default(0.4).notNull(),
  hitlAlwaysForActions: jsonb("hitl_always_for_actions").default(["retire"]).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// ── Pending Proposals (Phase 11 — HITL) ─────────────────────────────────────

export const pendingProposals = pgTable("pending_proposals", {
  proposalId: text("proposal_id").primaryKey(),
  proposal: jsonb("proposal").notNull(),
  simulation: jsonb("simulation").notNull(),
  score: jsonb("score").notNull(),
  snapshotId: text("snapshot_id"),
  status: text("status").default("pending_human").notNull(),
  requestedAt: text("requested_at").notNull(),
  resolvedAt: text("resolved_at"),
  resolvedBy: text("resolved_by"),
  resolutionReason: text("resolution_reason"),
});

// ── Telemetry Execution Traces (Phase 10) ───────────────────────────────────

export const telemetryExecutionTraces = pgTable("telemetry_execution_traces", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  taskId: text("task_id").notNull(),
  userPrompt: text("user_prompt").notNull(),
  assignedTeamGraph: jsonb("assigned_team_graph").notNull(),
  steps: jsonb("steps").default([]).notNull(),
  status: text("status").notNull(),                // running | completed | failed
  startedAt: text("started_at").notNull(),
  completedAt: text("completed_at"),
  error: text("error"),
});

// ── Telemetry Evolution Traces (Phase 10) ───────────────────────────────────

export const telemetryEvolutionTraces = pgTable("telemetry_evolution_traces", {
  id: text("id").primaryKey(),
  proposalId: text("proposal_id").notNull(),
  proposalType: text("proposal_type").notNull(),
  subject: text("subject").notNull(),
  snapshotId: text("snapshot_id"),
  simulatedScores: jsonb("simulated_scores").notNull(),
  governanceVerdict: jsonb("governance_verdict").notNull(),
  rolloutStatus: text("rollout_status").notNull(),
  approved: boolean("approved").notNull(),
  recordedAt: text("recorded_at").notNull(),
});

// ── Dynamic Provider Configuration (runtime model/default switching) ─────────

export const providerConfigs = pgTable("provider_configs", {
  providerId: text("provider_id").primaryKey(),
  defaultModel: text("default_model").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  /** Marked true on exactly one row at a time — the system-wide default. */
  defaultProvider: boolean("default_provider").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
