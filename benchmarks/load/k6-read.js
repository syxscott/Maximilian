/**
 * k6 load test for read endpoints (workspaces, executions, providers).
 *
 * Setup provisions 100 users, VUs round-robin between them so bcrypt
 * cost isn't on the hot path of every iteration. Targets:
 *   - p95 < 1000ms on list/get endpoints
 *   - p95 < 100ms on health
 *   - error rate < 5%
 *
 * Usage:
 *   k6 run --vus 50 --duration 60s benchmarks/load/k6-read.js
 *
 * Environment:
 *   BASE_URL — API base URL (default: http://localhost:3001)
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";
import { provisionUsers, authHeaders } from "./lib/auth.js";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3001";
const USER_POOL_SIZE = 100;

const errorRate = new Rate("errors");
const listDuration = new Trend("list_duration", true);
const getDuration = new Trend("get_duration", true);

export const options = {
  stages: [
    { duration: "10s", target: 20 },
    { duration: "40s", target: 50 },
    { duration: "10s", target: 0 },
  ],
  thresholds: {
    "http_req_duration{endpoint:list}": ["p(95)<1000"],
    "http_req_duration{endpoint:get}": ["p(95)<1000"],
    "http_req_duration{endpoint:health}": ["p(95)<100"],
    errors: ["rate<0.05"],
  },
};

export function setup() {
  return { users: provisionUsers(BASE_URL, USER_POOL_SIZE) };
}

function pickUser(data) {
  return data.users[__VU % data.users.length];
}

export default function (data) {
  const user = pickUser(data);
  const listParams = {
    ...authHeaders(user.accessToken),
    tags: { endpoint: "list" },
  };

  // List workspaces
  const listRes = http.get(`${BASE_URL}/api/workspaces?limit=20`, listParams);
  const listOk = check(listRes, {
    "list status is 200": (r) => r.status === 200,
    "list has items array": (r) => {
      try {
        const body = JSON.parse(r.body);
        return Array.isArray(body.items);
      } catch (e) {
        return false;
      }
    },
  });
  errorRate.add(!listOk);
  listDuration.add(listRes.timings.duration);

  // List executions
  const execRes = http.get(`${BASE_URL}/api/executions?limit=10`, listParams);
  errorRate.add(!check(execRes, { "exec status is 200": (r) => r.status === 200 }));

  // Get a specific workspace (fake ID — exercise the 404 path too)
  const getRes = http.get(
    `${BASE_URL}/api/workspaces/ws-loadtest-nonexistent`,
    { ...authHeaders(user.accessToken), tags: { endpoint: "get" } },
  );
  const getOk = check(getRes, {
    "get status is 404 (expected for fake id)": (r) => r.status === 404,
  });
  errorRate.add(!getOk);
  getDuration.add(getRes.timings.duration);

  // Health is unauthenticated — verify it stays snappy under load
  const healthRes = http.get(`${BASE_URL}/api/health`, {
    tags: { endpoint: "health" },
  });
  check(healthRes, { "health is 200": (r) => r.status === 200 });

  sleep(0.5 + Math.random());
}