// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

// GENERATED FILE — do not edit by hand.
// Source of truth: apps/api/openapi.json (regen: pnpm --filter @max/api client:gen).
// v0 boundary: response payloads are typed `unknown` unless the route
// declares an object schema; hand-written zod clients in src/api.ts stay
// authoritative for validated reads during the migration.

import { BASE, authHeaders } from "./api"

/** GET /health */
export async function getHealth(signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(`${BASE}/health`, {
    method: "GET",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    signal,
  })
  if (!res.ok) throw new Error(`${res.status} getHealth failed`)
  return res.json()
}

/** GET /ready */
export async function getReady(signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(`${BASE}/ready`, {
    method: "GET",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    signal,
  })
  if (!res.ok) throw new Error(`${res.status} getReady failed`)
  return res.json()
}

/** GET /providers */
export async function getProviders(signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(`${BASE}/providers`, {
    method: "GET",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    signal,
  })
  if (!res.ok) throw new Error(`${res.status} getProviders failed`)
  return res.json()
}

/** GET /flags */
export async function getFlags(signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(`${BASE}/flags`, {
    method: "GET",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    signal,
  })
  if (!res.ok) throw new Error(`${res.status} getFlags failed`)
  return res.json()
}

/** GET /flags/{name} */
export async function getFlagsByName(name: string, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(`${BASE}/flags/${encodeURIComponent(name)}`, {
    method: "GET",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    signal,
  })
  if (!res.ok) throw new Error(`${res.status} getFlagsByName failed`)
  return res.json()
}

/** POST /flags/{name}/override */
export async function postFlagsByNameOverride(
  name: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  const res = await fetch(`${BASE}/flags/${encodeURIComponent(name)}/override`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  })
  if (!res.ok) throw new Error(`${res.status} postFlagsByNameOverride failed`)
  return res.json()
}

/** DELETE /flags/{name}/override */
export async function delFlagsByNameOverride(name: string, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(`${BASE}/flags/${encodeURIComponent(name)}/override`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    signal,
  })
  if (!res.ok) throw new Error(`${res.status} delFlagsByNameOverride failed`)
  return res.json()
}

/** POST /flags/evaluate */
export async function postFlagsEvaluate(body?: unknown, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(`${BASE}/flags/evaluate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  })
  if (!res.ok) throw new Error(`${res.status} postFlagsEvaluate failed`)
  return res.json()
}

/** PUT /system/providers/default */
export async function putSystemProvidersDefault(
  body?: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  const res = await fetch(`${BASE}/system/providers/default`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  })
  if (!res.ok) throw new Error(`${res.status} putSystemProvidersDefault failed`)
  return res.json()
}

/** PUT /system/providers/{id}/model */
export async function putSystemProvidersByIdModel(
  id: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  const res = await fetch(`${BASE}/system/providers/${encodeURIComponent(id)}/model`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  })
  if (!res.ok) throw new Error(`${res.status} putSystemProvidersByIdModel failed`)
  return res.json()
}

/** GET /system/providers/{id}/health */
export async function getSystemProvidersByIdHealth(
  id: string,
  signal?: AbortSignal,
): Promise<unknown> {
  const res = await fetch(`${BASE}/system/providers/${encodeURIComponent(id)}/health`, {
    method: "GET",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    signal,
  })
  if (!res.ok) throw new Error(`${res.status} getSystemProvidersByIdHealth failed`)
  return res.json()
}

/** GET /system/providers/{id}/circuit-breaker/stats */
export async function getSystemProvidersByIdCircuitBreakerStats(
  id: string,
  signal?: AbortSignal,
): Promise<unknown> {
  const res = await fetch(
    `${BASE}/system/providers/${encodeURIComponent(id)}/circuit-breaker/stats`,
    {
      method: "GET",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      signal,
    },
  )
  if (!res.ok) throw new Error(`${res.status} getSystemProvidersByIdCircuitBreakerStats failed`)
  return res.json()
}

/** POST /system/providers/{id}/circuit-breaker/reset */
export async function postSystemProvidersByIdCircuitBreakerReset(
  id: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  const res = await fetch(
    `${BASE}/system/providers/${encodeURIComponent(id)}/circuit-breaker/reset`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    },
  )
  if (!res.ok) throw new Error(`${res.status} postSystemProvidersByIdCircuitBreakerReset failed`)
  return res.json()
}

/** GET /system/failover/queue */
export async function getSystemFailoverQueue(signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(`${BASE}/system/failover/queue`, {
    method: "GET",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    signal,
  })
  if (!res.ok) throw new Error(`${res.status} getSystemFailoverQueue failed`)
  return res.json()
}

/** POST /system/failover/queue/add */
export async function postSystemFailoverQueueAdd(
  body?: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  const res = await fetch(`${BASE}/system/failover/queue/add`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  })
  if (!res.ok) throw new Error(`${res.status} postSystemFailoverQueueAdd failed`)
  return res.json()
}

/** POST /system/failover/queue/remove */
export async function postSystemFailoverQueueRemove(
  body?: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  const res = await fetch(`${BASE}/system/failover/queue/remove`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  })
  if (!res.ok) throw new Error(`${res.status} postSystemFailoverQueueRemove failed`)
  return res.json()
}

/** GET /system/failover/auto */
export async function getSystemFailoverAuto(signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(`${BASE}/system/failover/auto`, {
    method: "GET",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    signal,
  })
  if (!res.ok) throw new Error(`${res.status} getSystemFailoverAuto failed`)
  return res.json()
}

/** PUT /system/failover/auto */
export async function putSystemFailoverAuto(
  body?: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  const res = await fetch(`${BASE}/system/failover/auto`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  })
  if (!res.ok) throw new Error(`${res.status} putSystemFailoverAuto failed`)
  return res.json()
}

/** GET /workflows */
export async function getWorkflows(signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(`${BASE}/workflows`, {
    method: "GET",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    signal,
  })
  if (!res.ok) throw new Error(`${res.status} getWorkflows failed`)
  return res.json()
}

/** POST /workflows/run */
export async function postWorkflowsRun(body?: unknown, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(`${BASE}/workflows/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  })
  if (!res.ok) throw new Error(`${res.status} postWorkflowsRun failed`)
  return res.json()
}

/** GET /workflows/:runId */
export async function getWorkflowsRunId(signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(`${BASE}/workflows/:runId`, {
    method: "GET",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    signal,
  })
  if (!res.ok) throw new Error(`${res.status} getWorkflowsRunId failed`)
  return res.json()
}

/** POST /chat */
export async function postChat(body?: unknown, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(`${BASE}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  })
  if (!res.ok) throw new Error(`${res.status} postChat failed`)
  return res.json()
}

/** GET /workspaces */
export async function getWorkspaces(signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(`${BASE}/workspaces`, {
    method: "GET",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    signal,
  })
  if (!res.ok) throw new Error(`${res.status} getWorkspaces failed`)
  return res.json()
}

/** GET /workspaces/{id} */
export async function getWorkspacesById(id: string, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(`${BASE}/workspaces/${encodeURIComponent(id)}`, {
    method: "GET",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    signal,
  })
  if (!res.ok) throw new Error(`${res.status} getWorkspacesById failed`)
  return res.json()
}

/** GET /workspaces/{id}/events */
export async function getWorkspacesByIdEvents(id: string, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(`${BASE}/workspaces/${encodeURIComponent(id)}/events`, {
    method: "GET",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    signal,
  })
  if (!res.ok) throw new Error(`${res.status} getWorkspacesByIdEvents failed`)
  return res.json()
}

/** GET /workspaces/{id}/stream */
export async function getWorkspacesByIdStream(id: string, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(`${BASE}/workspaces/${encodeURIComponent(id)}/stream`, {
    method: "GET",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    signal,
  })
  if (!res.ok) throw new Error(`${res.status} getWorkspacesByIdStream failed`)
  return res.json()
}

/** GET /workspaces/{id}/artifacts */
export async function getWorkspacesByIdArtifacts(
  id: string,
  signal?: AbortSignal,
): Promise<unknown> {
  const res = await fetch(`${BASE}/workspaces/${encodeURIComponent(id)}/artifacts`, {
    method: "GET",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    signal,
  })
  if (!res.ok) throw new Error(`${res.status} getWorkspacesByIdArtifacts failed`)
  return res.json()
}

/** GET /workspaces/{id}/artifacts/{name} */
export async function getWorkspacesByIdArtifactsByName(
  id: string,
  name: string,
  signal?: AbortSignal,
): Promise<unknown> {
  const res = await fetch(
    `${BASE}/workspaces/${encodeURIComponent(id)}/artifacts/${encodeURIComponent(name)}`,
    {
      method: "GET",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      signal,
    },
  )
  if (!res.ok) throw new Error(`${res.status} getWorkspacesByIdArtifactsByName failed`)
  return res.json()
}

/** POST /subscriptions */
export async function postSubscriptions(body?: unknown, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(`${BASE}/subscriptions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  })
  if (!res.ok) throw new Error(`${res.status} postSubscriptions failed`)
  return res.json()
}

/** GET /subscriptions */
export async function getSubscriptions(signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(`${BASE}/subscriptions`, {
    method: "GET",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    signal,
  })
  if (!res.ok) throw new Error(`${res.status} getSubscriptions failed`)
  return res.json()
}

/** DELETE /subscriptions/{id} */
export async function delSubscriptionsById(id: string, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(`${BASE}/subscriptions/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    signal,
  })
  if (!res.ok) throw new Error(`${res.status} delSubscriptionsById failed`)
  return res.json()
}

/** GET /events/stream */
export async function getEventsStream(signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(`${BASE}/events/stream`, {
    method: "GET",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    signal,
  })
  if (!res.ok) throw new Error(`${res.status} getEventsStream failed`)
  return res.json()
}

/** GET /evolution/metrics */
export async function getEvolutionMetrics(signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(`${BASE}/evolution/metrics`, {
    method: "GET",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    signal,
  })
  if (!res.ok) throw new Error(`${res.status} getEvolutionMetrics failed`)
  return res.json()
}

/** GET /evolution/metrics/{taskId} */
export async function getEvolutionMetricsByTaskId(
  taskId: string,
  signal?: AbortSignal,
): Promise<unknown> {
  const res = await fetch(`${BASE}/evolution/metrics/${encodeURIComponent(taskId)}`, {
    method: "GET",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    signal,
  })
  if (!res.ok) throw new Error(`${res.status} getEvolutionMetricsByTaskId failed`)
  return res.json()
}

/** GET /evolution/agents */
export async function getEvolutionAgents(signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(`${BASE}/evolution/agents`, {
    method: "GET",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    signal,
  })
  if (!res.ok) throw new Error(`${res.status} getEvolutionAgents failed`)
  return res.json()
}

/** GET /evolution/agents/{role} */
export async function getEvolutionAgentsByRole(
  role: string,
  signal?: AbortSignal,
): Promise<unknown> {
  const res = await fetch(`${BASE}/evolution/agents/${encodeURIComponent(role)}`, {
    method: "GET",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    signal,
  })
  if (!res.ok) throw new Error(`${res.status} getEvolutionAgentsByRole failed`)
  return res.json()
}

/** GET /evolution/leaderboard */
export async function getEvolutionLeaderboard(signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(`${BASE}/evolution/leaderboard`, {
    method: "GET",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    signal,
  })
  if (!res.ok) throw new Error(`${res.status} getEvolutionLeaderboard failed`)
  return res.json()
}

/** GET /evolution/leaderboard/{role} */
export async function getEvolutionLeaderboardByRole(
  role: string,
  signal?: AbortSignal,
): Promise<unknown> {
  const res = await fetch(`${BASE}/evolution/leaderboard/${encodeURIComponent(role)}`, {
    method: "GET",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    signal,
  })
  if (!res.ok) throw new Error(`${res.status} getEvolutionLeaderboardByRole failed`)
  return res.json()
}

/** GET /evolution/versions/{role} */
export async function getEvolutionVersionsByRole(
  role: string,
  signal?: AbortSignal,
): Promise<unknown> {
  const res = await fetch(`${BASE}/evolution/versions/${encodeURIComponent(role)}`, {
    method: "GET",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    signal,
  })
  if (!res.ok) throw new Error(`${res.status} getEvolutionVersionsByRole failed`)
  return res.json()
}

/** GET /evolution/versions/{role}/decisions */
export async function getEvolutionVersionsByRoleDecisions(
  role: string,
  signal?: AbortSignal,
): Promise<unknown> {
  const res = await fetch(`${BASE}/evolution/versions/${encodeURIComponent(role)}/decisions`, {
    method: "GET",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    signal,
  })
  if (!res.ok) throw new Error(`${res.status} getEvolutionVersionsByRoleDecisions failed`)
  return res.json()
}

/** POST /evolution/feedback */
export async function postEvolutionFeedback(
  body?: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  const res = await fetch(`${BASE}/evolution/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  })
  if (!res.ok) throw new Error(`${res.status} postEvolutionFeedback failed`)
  return res.json()
}

/** POST /evolution/oracle-triad */
export async function postEvolutionOracleTriad(
  body?: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  const res = await fetch(`${BASE}/evolution/oracle-triad`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  })
  if (!res.ok) throw new Error(`${res.status} postEvolutionOracleTriad failed`)
  return res.json()
}

/** POST /evolution/evolve/{role} */
export async function postEvolutionEvolveByRole(
  role: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  const res = await fetch(`${BASE}/evolution/evolve/${encodeURIComponent(role)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  })
  if (!res.ok) throw new Error(`${res.status} postEvolutionEvolveByRole failed`)
  return res.json()
}

/** GET /system/provider-presets */
export async function getSystemProviderPresets(signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(`${BASE}/system/provider-presets`, {
    method: "GET",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    signal,
  })
  if (!res.ok) throw new Error(`${res.status} getSystemProviderPresets failed`)
  return res.json()
}

/** POST /system/providers/{id}/test-chat */
export async function postSystemProvidersByIdTestChat(
  id: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  const res = await fetch(`${BASE}/system/providers/${encodeURIComponent(id)}/test-chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  })
  if (!res.ok) throw new Error(`${res.status} postSystemProvidersByIdTestChat failed`)
  return res.json()
}

/** GET /system/session-store */
export async function getSystemSessionStore(signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(`${BASE}/system/session-store`, {
    method: "GET",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    signal,
  })
  if (!res.ok) throw new Error(`${res.status} getSystemSessionStore failed`)
  return res.json()
}

/** GET /sessions */
export async function getSessions(signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(`${BASE}/sessions`, {
    method: "GET",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    signal,
  })
  if (!res.ok) throw new Error(`${res.status} getSessions failed`)
  return res.json()
}

/** GET /sessions/{id}/messages */
export async function getSessionsByIdMessages(id: string, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(`${BASE}/sessions/${encodeURIComponent(id)}/messages`, {
    method: "GET",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    signal,
  })
  if (!res.ok) throw new Error(`${res.status} getSessionsByIdMessages failed`)
  return res.json()
}

/** GET /sessions/{id}/timeline */
export async function getSessionsByIdTimeline(id: string, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(`${BASE}/sessions/${encodeURIComponent(id)}/timeline`, {
    method: "GET",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    signal,
  })
  if (!res.ok) throw new Error(`${res.status} getSessionsByIdTimeline failed`)
  return res.json()
}

/** GET /sessions/search */
export async function getSessionsSearch(signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(`${BASE}/sessions/search`, {
    method: "GET",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    signal,
  })
  if (!res.ok) throw new Error(`${res.status} getSessionsSearch failed`)
  return res.json()
}

/** GET /system/vault */
export async function getSystemVault(signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(`${BASE}/system/vault`, {
    method: "GET",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    signal,
  })
  if (!res.ok) throw new Error(`${res.status} getSystemVault failed`)
  return res.json()
}

/** GET /evolution/oracle-lessons */
export async function getEvolutionOracleLessons(signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(`${BASE}/evolution/oracle-lessons`, {
    method: "GET",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    signal,
  })
  if (!res.ok) throw new Error(`${res.status} getEvolutionOracleLessons failed`)
  return res.json()
}

/** GET /obs/executions */
export async function getObsExecutions(signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(`${BASE}/obs/executions`, {
    method: "GET",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    signal,
  })
  if (!res.ok) throw new Error(`${res.status} getObsExecutions failed`)
  return res.json()
}

/** GET /obs/evolutions */
export async function getObsEvolutions(signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(`${BASE}/obs/evolutions`, {
    method: "GET",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    signal,
  })
  if (!res.ok) throw new Error(`${res.status} getObsEvolutions failed`)
  return res.json()
}

/** GET /obs/lineage/agent/{role} */
export async function getObsLineageAgentByRole(
  role: string,
  signal?: AbortSignal,
): Promise<unknown> {
  const res = await fetch(`${BASE}/obs/lineage/agent/${encodeURIComponent(role)}`, {
    method: "GET",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    signal,
  })
  if (!res.ok) throw new Error(`${res.status} getObsLineageAgentByRole failed`)
  return res.json()
}

/** GET /obs/usage/summary */
export async function getObsUsageSummary(signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(`${BASE}/obs/usage/summary`, {
    method: "GET",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    signal,
  })
  if (!res.ok) throw new Error(`${res.status} getObsUsageSummary failed`)
  return res.json()
}

/** GET /obs/usage/daily */
export async function getObsUsageDaily(signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(`${BASE}/obs/usage/daily`, {
    method: "GET",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    signal,
  })
  if (!res.ok) throw new Error(`${res.status} getObsUsageDaily failed`)
  return res.json()
}

/** GET /obs/usage/latency */
export async function getObsUsageLatency(signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(`${BASE}/obs/usage/latency`, {
    method: "GET",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    signal,
  })
  if (!res.ok) throw new Error(`${res.status} getObsUsageLatency failed`)
  return res.json()
}

/** GET /obs/usage/windows */
export async function getObsUsageWindows(signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(`${BASE}/obs/usage/windows`, {
    method: "GET",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    signal,
  })
  if (!res.ok) throw new Error(`${res.status} getObsUsageWindows failed`)
  return res.json()
}

/** GET /obs/graph/{executionId} */
export async function getObsGraphByExecutionId(
  executionId: string,
  signal?: AbortSignal,
): Promise<unknown> {
  const res = await fetch(`${BASE}/obs/graph/${encodeURIComponent(executionId)}`, {
    method: "GET",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    signal,
  })
  if (!res.ok) throw new Error(`${res.status} getObsGraphByExecutionId failed`)
  return res.json()
}

/** GET /obs/timeline */
export async function getObsTimeline(signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(`${BASE}/obs/timeline`, {
    method: "GET",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    signal,
  })
  if (!res.ok) throw new Error(`${res.status} getObsTimeline failed`)
  return res.json()
}

/** GET /permissions */
export async function getPermissions(signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(`${BASE}/permissions`, {
    method: "GET",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    signal,
  })
  if (!res.ok) throw new Error(`${res.status} getPermissions failed`)
  return res.json()
}

/** PUT /permissions */
export async function putPermissions(body?: unknown, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(`${BASE}/permissions`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  })
  if (!res.ok) throw new Error(`${res.status} putPermissions failed`)
  return res.json()
}

/** POST /permissions/resolve */
export async function postPermissionsResolve(
  body?: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  const res = await fetch(`${BASE}/permissions/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  })
  if (!res.ok) throw new Error(`${res.status} postPermissionsResolve failed`)
  return res.json()
}

/** POST /permissions/test */
export async function postPermissionsTest(body?: unknown, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(`${BASE}/permissions/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  })
  if (!res.ok) throw new Error(`${res.status} postPermissionsTest failed`)
  return res.json()
}

/** POST /permissions/reset */
export async function postPermissionsReset(body?: unknown, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(`${BASE}/permissions/reset`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  })
  if (!res.ok) throw new Error(`${res.status} postPermissionsReset failed`)
  return res.json()
}

/** POST /permissions/answer */
export async function postPermissionsAnswer(
  body?: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  const res = await fetch(`${BASE}/permissions/answer`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  })
  if (!res.ok) throw new Error(`${res.status} postPermissionsAnswer failed`)
  return res.json()
}

/** GET /permissions/audit */
export async function getPermissionsAudit(signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(`${BASE}/permissions/audit`, {
    method: "GET",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    signal,
  })
  if (!res.ok) throw new Error(`${res.status} getPermissionsAudit failed`)
  return res.json()
}

/** POST /approvals/answer */
export async function postApprovalsAnswer(body?: unknown, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(`${BASE}/approvals/answer`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  })
  if (!res.ok) throw new Error(`${res.status} postApprovalsAnswer failed`)
  return res.json()
}

/** GET /opencode/sessions */
export async function getOpencodeSessions(signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(`${BASE}/opencode/sessions`, {
    method: "GET",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    signal,
  })
  if (!res.ok) throw new Error(`${res.status} getOpencodeSessions failed`)
  return res.json()
}

/** GET /opencode/sessions/{id} */
export async function getOpencodeSessionsById(id: string, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(`${BASE}/opencode/sessions/${encodeURIComponent(id)}`, {
    method: "GET",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    signal,
  })
  if (!res.ok) throw new Error(`${res.status} getOpencodeSessionsById failed`)
  return res.json()
}

/** GET /opencode/health */
export async function getOpencodeHealth(signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(`${BASE}/opencode/health`, {
    method: "GET",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    signal,
  })
  if (!res.ok) throw new Error(`${res.status} getOpencodeHealth failed`)
  return res.json()
}

/** GET /opencode/events */
export async function getOpencodeEvents(signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(`${BASE}/opencode/events`, {
    method: "GET",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    signal,
  })
  if (!res.ok) throw new Error(`${res.status} getOpencodeEvents failed`)
  return res.json()
}

export const GENERATED_OPERATION_COUNT = 73
