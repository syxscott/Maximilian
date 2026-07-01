/**
 * Shared Zod schemas for request/response validation and OpenAPI generation.
 * Used by @hono/zod-openapi routes.
 */

import { z } from "zod";

// ── Common ────────────────────────────────────────────────────────────────

export const ErrorSchema = z.object({
  error: z.string(),
  code: z.string().optional(),
  details: z.unknown().optional(),
});

export const IdParamsSchema = z.object({
  id: z.string().min(1),
});

// ── Health ────────────────────────────────────────────────────────────────

export const ProviderSchema = z.object({
  id: z.string(),
  name: z.string(),
});

export const HealthResponseSchema = z.object({
  status: z.enum(["ok", "degraded", "down"]),
  providers: z.array(ProviderSchema),
  defaultProvider: z.string(),
  evolution: z.string(),
  dagsMode: z.string(),
  metaAgent: z.string(),
  telemetry: z.string(),
  multiTenant: z.string(),
  database: z.string(),
});

export const ReadyResponseSchema = z.object({
  ready: z.boolean(),
  database: z.boolean(),
  redis: z.boolean(),
});

// ── Chat ──────────────────────────────────────────────────────────────────

export const ChatRequestSchema = z.object({
  message: z.string().min(1).max(8000),
});

export const ChatResponseSchema = z.object({
  workspaceId: z.string(),
  planId: z.string(),
  status: z.string(),
  mode: z.string().optional(),
  teamSize: z.number().optional(),
});

// ── Workspace ─────────────────────────────────────────────────────────────

export const WorkspaceSchema = z.object({
  id: z.string(),
  userRequest: z.string(),
  status: z.enum(["pending", "running", "planning", "completed", "failed"]),
  plan: z.unknown().optional(),
  results: z.array(z.unknown()),
  review: z.unknown().optional(),
  error: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const WorkspaceListResponseSchema = z.object({
  items: z.array(z.string()),
  nextCursor: z.string().optional(),
  total: z.number(),
});

export const WorkspaceListQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const ArtifactListResponseSchema = z.object({
  workspaceId: z.string(),
  artifacts: z.array(z.string()),
});

// ── Auth ──────────────────────────────────────────────────────────────────

export const AuthRegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  displayName: z.string().optional(),
  tenantName: z.string().optional(),
});

export const AuthLoginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

export const AuthTokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number().int(),
});

export const AuthRefreshSchema = z.object({
  refreshToken: z.string(),
});

// ── Tenant ────────────────────────────────────────────────────────────────

export const TenantSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  status: z.string(),
  plan: z.string().optional(),
  createdAt: z.string(),
});

export const TenantListResponseSchema = z.object({
  items: z.array(TenantSchema),
});

export const CreateTenantSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().min(1).max(50).regex(/^[a-z0-9-]+$/),
  plan: z.string().optional(),
});

export const UpdateTenantSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  plan: z.string().optional(),
  status: z.enum(["active", "suspended", "archived"]).optional(),
});

// ── Governance ────────────────────────────────────────────────────────────

export const ProposalSchema = z.object({
  proposalId: z.string(),
  proposal: z.unknown(),
  simulation: z.unknown().optional(),
  score: z.unknown().optional(),
});

export const ProposalListResponseSchema = z.object({
  proposals: z.array(ProposalSchema),
});

// ── Providers ─────────────────────────────────────────────────────────────

export const ProviderListResponseSchema = z.object({
  providers: z.array(ProviderSchema),
});

// ── Permissions ───────────────────────────────────────────────────────────

export const ToolNameSchema = z.enum(["bash", "read", "write", "edit", "glob", "grep"]);
export const PermissionActionSchema = z.enum(["allow", "ask", "deny"]);

export const PermissionsConfigSchema = z.object({
  defaults: z.record(PermissionActionSchema),
  patterns: z.record(z.record(PermissionActionSchema)),
});

export const ResolveRequestSchema = z.object({
  tool: ToolNameSchema,
  input: z.record(z.unknown()).default({}),
});

export const ResolveResponseSchema = z.object({
  tool: ToolNameSchema,
  decision: PermissionActionSchema,
  config: PermissionsConfigSchema,
});

export const TestRequestSchema = z.object({
  pattern: z.string().min(1),
  value: z.string().min(1),
});

export const TestResponseSchema = z.object({
  pattern: z.string(),
  value: z.string(),
  matches: z.boolean(),
});

export const AnswerRequestSchema = z.object({
  requestId: z.string().min(1),
  decision: z.enum(["allow", "deny"]),
});

export const AnswerResponseSchema = z.object({
  requestId: z.string(),
  decision: z.enum(["allow", "deny"]),
});

// ── Permission audit log ───────────────────────────────────────────────────

export const PermissionAuditEntrySchema = z.object({
  at: z.string(),
  requestId: z.string(),
  workspaceId: z.string(),
  taskId: z.string(),
  tool: z.string(),
  target: z.string(),
  decision: z.enum(["ask", "allow", "deny"]),
  promptedAt: z.string().optional(),
});

export const PermissionAuditQuerySchema = z.object({
  since: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
  tool: z.string().optional(),
  workspaceId: z.string().optional(),
});

export const PermissionAuditResponseSchema = z.object({
  items: z.array(PermissionAuditEntrySchema),
  total: z.number(),
});

// ── Auth ──────────────────────────────────────────────────────────────────

export const AuthRegisterRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export const AuthLoginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

export const AuthRefreshRequestSchema = z.object({
  refreshToken: z.string(),
});

export const AuthTokenResponseSchema = z.object({
  userId: z.string().optional(),
  email: z.string().optional(),
  role: z.string().optional(),
  tenantId: z.string().nullable().optional(),
  accessToken: z.string(),
  refreshToken: z.string(),
});

export const AuthRefreshResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
});

export const AuthLogoutResponseSchema = z.object({
  ok: z.boolean(),
});
