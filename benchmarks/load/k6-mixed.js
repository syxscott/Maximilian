/**
 * k6 mixed workload test — simulates real user behavior.
 *
 * Distribution (weighted random per iteration):
 *   - 40% list workspaces
 *   - 20% get workspace (404 for nonexistent IDs expected)
 *   - 10% health check
 *   - 15% list providers
 *   - 10% list executions
 *   -  5% submit chat (expensive)
 *
 * Auth-required: provisions 100 users in setup(), VUs round-robin.
 *
 * Targets:
 *   - p95 < 2000ms overall
 *   - p95 < 100ms on /api/health
 *   - p95 < 500ms on /api/workspaces (list)
 *   - error rate < 5%
 *
 * Usage:
 *   k6 run --vus 50 --duration 60s benchmarks/load/k6-mixed.js
 *
 * Environment:
 *   BASE_URL — API base URL (default: http://localhost:3001)
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend, Counter } from "k6/metrics";
import { provisionUsers, authHeaders } from "./lib/auth.js";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3001";
const USER_POOL_SIZE = 100;

const errorRate = new Rate("errors");
const mixedDuration = new Trend("mixed_duration", true);
const endpointHits = new Counter("endpoint_hits");

const REQUESTS = [
  { method: "GET", path: "/api/workspaces?limit=20", weight: 40, name: "list-workspaces" },
  { method: "GET", path: "/api/workspaces/ws-loadtest-nonexistent", weight: 20, name: "get-workspace", expect404: true },
  { method: "GET", path: "/api/health", weight: 10, name: "health", public: true },
  { method: "GET", path: "/api/providers", weight: 15, name: "list-providers" },
  { method: "GET", path: "/api/executions?limit=10", weight: 10, name: "list-executions" },
  {
    method: "POST",
    path: "/api/chat",
    body: () => JSON.stringify({ message: `mixed-load vu=${__VU} iter=${__ITER}` }),
    weight: 5,
    name: "chat",
  },
];

// Build weighted request pool
const pool = [];
let total = 0;
for (const r of REQUESTS) {
  total += r.weight;
}
for (const r of REQUESTS) {
  const count = Math.round((r.weight / total) * 100);
  for (let i = 0; i < count; i++) pool.push(r);
}

export const options = {
  stages: [
    { duration: "15s", target: 30 },
    { duration: "30s", target: 50 },
    { duration: "15s", target: 0 },
  ],
  thresholds: {
    "http_req_duration": ["p(95)<2000"],
    "http_req_duration{endpoint:health}": ["p(95)<100"],
    "http_req_duration{endpoint:list-workspaces}": ["p(95)<500"],
    errors: ["rate<0.05"],
  },
};

export function setup() {
  return { users: provisionUsers(BASE_URL, USER_POOL_SIZE) };
}

function pickRequest() {
  return pool[Math.floor(Math.random() * pool.length)];
}

export default function (data) {
  const user = data.users[__VU % data.users.length];
  const req = pickRequest();
  endpointHits.add(1, { endpoint: req.name });

  const params = {
    ...(req.public ? { headers: { "Content-Type": "application/json" } } : authHeaders(user.accessToken)),
    tags: { endpoint: req.name },
  };

  let res;
  if (req.method === "POST") {
    res = http.post(`${BASE_URL}${req.path}`, req.body(), params);
  } else {
    res = http.get(`${BASE_URL}${req.path}`, params);
  }

  const ok = check(res, {
    "status matches expectation": (r) => {
      if (req.expect404 && r.status === 404) return true;
      return r.status >= 200 && r.status < 400;
    },
  });

  errorRate.add(!ok);
  mixedDuration.add(res.timings.duration);

  sleep(0.5 + Math.random() * 2);
}