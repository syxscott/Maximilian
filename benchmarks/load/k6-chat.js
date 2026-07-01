/**
 * k6 load test for POST /api/chat.
 *
 * Auth-required. Provisions a small pool of users (chat is expensive
 * enough that 50 VUs x 100 users is plenty) and submits one chat per
 * VU per iteration. Tracks end-to-end chat latency (which includes
 * workspace creation + enqueue, NOT worker execution — chat returns
 * 202-style once the job is enqueued).
 *
 * Targets:
 *   - p95 < 2000ms on /api/chat
 *   - error rate < 10% (allows for transient 503 when worker pool
 *     is full)
 *
 * Usage:
 *   k6 run --vus 50 --duration 60s benchmarks/load/k6-chat.js
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
const chatDuration = new Trend("chat_duration", true);

export const options = {
  stages: [
    { duration: "15s", target: 25 },
    { duration: "30s", target: 50 },
    { duration: "15s", target: 0 },
  ],
  thresholds: {
    "http_req_duration{endpoint:chat}": ["p(95)<2000"],
    errors: ["rate<0.10"],
  },
};

export function setup() {
  return { users: provisionUsers(BASE_URL, USER_POOL_SIZE) };
}

export default function (data) {
  const user = data.users[__VU % data.users.length];

  const payload = JSON.stringify({
    message: `Load test message vu=${__VU} iter=${__ITER}`,
  });

  const params = {
    ...authHeaders(user.accessToken),
    tags: { endpoint: "chat" },
  };

  const res = http.post(`${BASE_URL}/api/chat`, payload, params);

  const ok = check(res, {
    "status is 200 or 202": (r) => r.status === 200 || r.status === 202,
    "has workspaceId": (r) => {
      try {
        return JSON.parse(r.body).workspaceId !== undefined;
      } catch (e) {
        return false;
      }
    },
  });

  errorRate.add(!ok);
  chatDuration.add(res.timings.duration);

  sleep(1 + Math.random());
}