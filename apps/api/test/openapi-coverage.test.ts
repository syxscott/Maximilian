/**
 * Comprehensive OpenAPI coverage — verifies that every route group
 * registered via createRoute() appears in the generated OpenAPI document
 * with the correct method and path.
 */

import { describe, it, expect } from "vitest";
import { OpenAPIHono } from "@hono/zod-openapi";

// Auth
import { authRegisterRoute, authLoginRoute, authRefreshRoute, authLogoutRoute } from "../src/routes/auth";
// Tenants
import { tenantCreateRoute, tenantListRoute, tenantGetRoute, tenantUpdateRoute, tenantDeleteRoute } from "../src/routes/tenants";
// Evolution
import { listMetricsRoute, getMetricRoute, listAgentsRoute, getAgentRoute, leaderboardRoute, leaderboardForRoleRoute, listVersionsRoute, listDecisionsRoute, recordFeedbackRoute, triggerEvolveRoute } from "../src/routes/evolution";
// Executions
import { listExecutionsRoute, getExecutionRoute, listExecutionsForWorkspaceRoute, listExecutionsForRoleRoute, appendExecutionFeedbackRoute } from "../src/routes/executions";
// Learning
import { learningStatusRoute, learningAgentsRoute, learningEvolutionHistoryRoute, learningFailurePatternsRoute, learningMineFailurePatternsRoute } from "../src/routes/learning";
// Meta
import { listCapabilitiesRoute, getCapabilityRoute, listProposalsRoute, runCycleRoute, listEventsRoute, countEventsRoute, checkGovernanceRoute, simulateRoute, compareSimulationsRoute, getGovernanceConfigRoute, putGovernanceConfigRoute } from "../src/routes/meta";
// Obs
import { listObsExecutionsRoute, listObsEvolutionsRoute, lineageByRoleRoute, obsGraphRoute, obsTimelineRoute } from "../src/routes/obs";
// Usage
import { usageSummaryRoute, usageDailyRoute, usageLatencyRoute } from "../src/routes/usage";
// Gov
import { listPendingProposalsRoute, resolveProposalRoute } from "../src/routes/gov";
// Permissions
import { getPermissionsRoute, putPermissionsRoute, resolvePermissionRoute, testPermissionRoute, resetPermissionsRoute, answerPermissionRoute, auditPermissionsRoute } from "../src/routes/permissions";
// Workspace
import { listWorkspacesRoute, getWorkspaceRoute, getWorkspaceEventsRoute, listArtifactsRoute, getArtifactRoute, streamWorkspaceRoute } from "../src/routes/workspace";
// System
import { listProvidersRoute, healthRoute, readyRoute } from "../src/routes/system";
// Chat
import { postChatRoute } from "../src/routes/chat";

// Map of route groups → expected {method, path} entries.
const routeGroups: Record<string, Array<{ method: string; path: string }>> = {
  auth: [
    { method: "post", path: "/auth/register" },
    { method: "post", path: "/auth/login" },
    { method: "post", path: "/auth/refresh" },
    { method: "post", path: "/auth/logout" },
  ],
  tenants: [
    { method: "post", path: "/tenants" },
    { method: "get", path: "/tenants" },
    { method: "get", path: "/tenants/{id}" },
    { method: "put", path: "/tenants/{id}" },
    { method: "delete", path: "/tenants/{id}" },
  ],
  evolution: [
    { method: "get", path: "/evolution/metrics" },
    { method: "get", path: "/evolution/metrics/{taskId}" },
    { method: "get", path: "/evolution/agents" },
    { method: "get", path: "/evolution/agents/{role}" },
    { method: "get", path: "/evolution/leaderboard" },
    { method: "get", path: "/evolution/leaderboard/{role}" },
    { method: "get", path: "/evolution/versions/{role}" },
    { method: "get", path: "/evolution/versions/{role}/decisions" },
    { method: "post", path: "/evolution/feedback" },
    { method: "post", path: "/evolution/evolve/{role}" },
  ],
  executions: [
    { method: "get", path: "/executions" },
    { method: "get", path: "/executions/{id}" },
    { method: "get", path: "/executions/workspace/{workspaceId}" },
    { method: "get", path: "/executions/role/{role}" },
    { method: "post", path: "/executions/{id}/feedback" },
  ],
  learning: [
    { method: "get", path: "/learning/status" },
    { method: "get", path: "/learning/agents" },
    { method: "get", path: "/learning/evolution-history" },
    { method: "get", path: "/learning/failure-patterns" },
    { method: "post", path: "/learning/mine-failure-patterns" },
  ],
  meta: [
    { method: "get", path: "/meta/capabilities" },
    { method: "get", path: "/meta/capabilities/{id}" },
    { method: "get", path: "/meta/proposals" },
    { method: "post", path: "/meta/cycle" },
    { method: "get", path: "/meta/events" },
    { method: "get", path: "/meta/events/count" },
    { method: "post", path: "/meta/governance/check" },
    { method: "post", path: "/meta/simulate" },
    { method: "post", path: "/meta/simulate/compare" },
    { method: "get", path: "/meta/governance/config" },
    { method: "put", path: "/meta/governance/config" },
  ],
  observability: [
    { method: "get", path: "/obs/executions" },
    { method: "get", path: "/obs/evolutions" },
    { method: "get", path: "/obs/lineage/agent/{role}" },
    { method: "get", path: "/obs/graph/{executionId}" },
    { method: "get", path: "/obs/timeline" },
  ],
  usage: [
    { method: "get", path: "/obs/usage/summary" },
    { method: "get", path: "/obs/usage/daily" },
    { method: "get", path: "/obs/usage/latency" },
  ],
  governance: [
    { method: "get", path: "/gov/pending" },
    { method: "post", path: "/gov/proposals/{id}/action" },
  ],
  permissions: [
    { method: "get", path: "/permissions" },
    { method: "put", path: "/permissions" },
    { method: "post", path: "/permissions/resolve" },
    { method: "post", path: "/permissions/test" },
    { method: "post", path: "/permissions/reset" },
    { method: "post", path: "/permissions/answer" },
    { method: "get", path: "/permissions/audit" },
  ],
  workspaces: [
    { method: "get", path: "/workspaces" },
    { method: "get", path: "/workspaces/{id}" },
    { method: "get", path: "/workspaces/{id}/events" },
    { method: "get", path: "/workspaces/{id}/stream" },
    { method: "get", path: "/workspaces/{id}/artifacts" },
    { method: "get", path: "/workspaces/{id}/artifacts/{name}" },
  ],
  system: [
    { method: "get", path: "/providers" },
    { method: "get", path: "/health" },
    { method: "get", path: "/ready" },
  ],
  chat: [
    { method: "post", path: "/chat" },
  ],
};

describe("OpenAPI comprehensive coverage", () => {
  // Build a minimal OpenAPIHono app that registers all route definitions
  // with no-op handlers. We only need the spec, not real business logic.
  const app = new OpenAPIHono();

  const noop = (c: any) => c.json({ ok: true });

  // Auth
  app.openapi(authRegisterRoute, noop);
  app.openapi(authLoginRoute, noop);
  app.openapi(authRefreshRoute, noop);
  app.openapi(authLogoutRoute, noop);
  // Tenants
  app.openapi(tenantCreateRoute, noop);
  app.openapi(tenantListRoute, noop);
  app.openapi(tenantGetRoute, noop);
  app.openapi(tenantUpdateRoute, noop);
  app.openapi(tenantDeleteRoute, noop);
  // Evolution
  app.openapi(listMetricsRoute, noop);
  app.openapi(getMetricRoute, noop);
  app.openapi(listAgentsRoute, noop);
  app.openapi(getAgentRoute, noop);
  app.openapi(leaderboardRoute, noop);
  app.openapi(leaderboardForRoleRoute, noop);
  app.openapi(listVersionsRoute, noop);
  app.openapi(listDecisionsRoute, noop);
  app.openapi(recordFeedbackRoute, noop);
  app.openapi(triggerEvolveRoute, noop);
  // Executions
  app.openapi(listExecutionsRoute, noop);
  app.openapi(getExecutionRoute, noop);
  app.openapi(listExecutionsForWorkspaceRoute, noop);
  app.openapi(listExecutionsForRoleRoute, noop);
  app.openapi(appendExecutionFeedbackRoute, noop);
  // Learning
  app.openapi(learningStatusRoute, noop);
  app.openapi(learningAgentsRoute, noop);
  app.openapi(learningEvolutionHistoryRoute, noop);
  app.openapi(learningFailurePatternsRoute, noop);
  app.openapi(learningMineFailurePatternsRoute, noop);
  // Meta
  app.openapi(listCapabilitiesRoute, noop);
  app.openapi(getCapabilityRoute, noop);
  app.openapi(listProposalsRoute, noop);
  app.openapi(runCycleRoute, noop);
  app.openapi(listEventsRoute, noop);
  app.openapi(countEventsRoute, noop);
  app.openapi(checkGovernanceRoute, noop);
  app.openapi(simulateRoute, noop);
  app.openapi(compareSimulationsRoute, noop);
  app.openapi(getGovernanceConfigRoute, noop);
  app.openapi(putGovernanceConfigRoute, noop);
  // Obs
  app.openapi(listObsExecutionsRoute, noop);
  app.openapi(listObsEvolutionsRoute, noop);
  app.openapi(lineageByRoleRoute, noop);
  app.openapi(obsGraphRoute, noop);
  app.openapi(obsTimelineRoute, noop);
  // Usage
  app.openapi(usageSummaryRoute, noop);
  app.openapi(usageDailyRoute, noop);
  app.openapi(usageLatencyRoute, noop);
  // Gov
  app.openapi(listPendingProposalsRoute, noop);
  app.openapi(resolveProposalRoute, noop);
  // Permissions
  app.openapi(getPermissionsRoute, noop);
  app.openapi(putPermissionsRoute, noop);
  app.openapi(resolvePermissionRoute, noop);
  app.openapi(testPermissionRoute, noop);
  app.openapi(resetPermissionsRoute, noop);
  app.openapi(answerPermissionRoute, noop);
  app.openapi(auditPermissionsRoute, noop);
  // Workspace
  app.openapi(listWorkspacesRoute, noop);
  app.openapi(getWorkspaceRoute, noop);
  app.openapi(getWorkspaceEventsRoute, noop);
  app.openapi(listArtifactsRoute, noop);
  app.openapi(getArtifactRoute, noop);
  app.openapi(streamWorkspaceRoute, noop);
  // System
  app.openapi(listProvidersRoute, noop);
  app.openapi(healthRoute, noop);
  app.openapi(readyRoute, noop);
  // Chat
  app.openapi(postChatRoute, noop);

  app.doc("/openapi.json", {
    openapi: "3.1.0",
    info: { title: "Test API", version: "0.0.0" },
  });

  it("all route groups appear in the OpenAPI document", async () => {
    const res = await app.request("/openapi.json");
    expect(res.status).toBe(200);
    const doc = (await res.json()) as { paths: Record<string, Record<string, unknown>> };

    for (const [group, routes] of Object.entries(routeGroups)) {
      for (const { method, path } of routes) {
        expect(doc.paths[path], `[${group}] path ${path} should exist`).toBeDefined();
        expect(doc.paths[path][method], `[${group}] ${method.toUpperCase()} ${path} should be registered`).toBeDefined();
      }
    }
  });

  it("total path count matches expected", async () => {
    const res = await app.request("/openapi.json");
    const doc = (await res.json()) as { paths: Record<string, Record<string, unknown>> };
    const totalRoutes = Object.values(routeGroups).reduce((sum, routes) => sum + routes.length, 0);

    // Count actual methods in the doc (each method on each path = 1 route)
    let docRouteCount = 0;
    for (const methods of Object.values(doc.paths)) {
      docRouteCount += Object.keys(methods).length;
    }

    expect(docRouteCount).toBe(totalRoutes);
  });

  // Routes that are POST/PUT but have no request body (e.g. logout, mine-failure-patterns).
  const bodylessPostRoutes = new Set([
    "POST /auth/logout",
    "POST /learning/mine-failure-patterns",
    "POST /evolution/evolve/{role}",
    "POST /permissions/reset",
  ]);

  it("all POST/PUT routes with bodies have request schemas", async () => {
    const res = await app.request("/openapi.json");
    const doc = (await res.json()) as {
      paths: Record<string, Record<string, { requestBody?: { content?: Record<string, unknown> } }>>;
    };

    for (const [group, routes] of Object.entries(routeGroups)) {
      for (const { method, path } of routes) {
        if (method === "post" || method === "put") {
          const key = `${method.toUpperCase()} ${path}`;
          if (bodylessPostRoutes.has(key)) continue;
          const op = doc.paths[path]?.[method];
          expect(op?.requestBody?.content, `[${group}] ${key} should have requestBody content`).toBeDefined();
        }
      }
    }
  });
});
