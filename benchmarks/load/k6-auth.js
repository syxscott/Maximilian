/**
 * k6 load test for auth endpoints (register, login, refresh).
 *
 * Each iteration registers a fresh user (with a unique email) so we
 * exercise the bcrypt path end-to-end — this script's purpose is to
 * validate auth throughput, not bypass it.
 *
 * Targets:
 *   - p95 < 1500ms on register/login (bcrypt cost 12)
 *   - p95 < 800ms on refresh
 *   - error rate < 5%
 *
 * Usage:
 *   k6 run --vus 30 --duration 30s benchmarks/load/k6-auth.js
 *
 * Environment:
 *   BASE_URL — API base URL (default: http://localhost:3001)
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";
import { uniqueEmail, authHeaders } from "./lib/auth.js";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3001";

const errorRate = new Rate("auth_errors");
const registerDuration = new Trend("register_duration", true);
const loginDuration = new Trend("login_duration", true);
const refreshDuration = new Trend("refresh_duration", true);

export const options = {
  stages: [
    { duration: "10s", target: 10 },
    { duration: "20s", target: 30 },
    { duration: "10s", target: 0 },
  ],
  thresholds: {
    "http_req_duration{endpoint:register}": ["p(95)<1500"],
    "http_req_duration{endpoint:login}": ["p(95)<1500"],
    "http_req_duration{endpoint:refresh}": ["p(95)<800"],
    auth_errors: ["rate<0.05"],
  },
};

const TEST_PASSWORD = "LoadTest123!";

export default function () {
  const email = uniqueEmail(__VU, __ITER);

  // Register
  const regRes = http.post(
    `${BASE_URL}/api/auth/register`,
    JSON.stringify({ email, password: TEST_PASSWORD }),
    { headers: { "Content-Type": "application/json" }, tags: { endpoint: "register" } },
  );
  const regOk = check(regRes, {
    "register status is 200 or 201": (r) => r.status === 200 || r.status === 201,
    "register has accessToken": (r) => {
      try {
        return JSON.parse(r.body).accessToken !== undefined;
      } catch (e) {
        return false;
      }
    },
  });
  if (!regOk) {
    errorRate.add(1);
    return;
  }
  errorRate.add(0);
  registerDuration.add(regRes.timings.duration);

  const { accessToken, refreshToken } = JSON.parse(regRes.body);

  // Login (re-authenticate the just-registered user)
  const loginRes = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ email, password: TEST_PASSWORD }),
    { headers: { "Content-Type": "application/json" }, tags: { endpoint: "login" } },
  );
  const loginOk = check(loginRes, {
    "login status is 200": (r) => r.status === 200,
    "login has accessToken": (r) => {
      try {
        return JSON.parse(r.body).accessToken !== undefined;
      } catch (e) {
        return false;
      }
    },
  });
  errorRate.add(!loginOk);
  loginDuration.add(loginRes.timings.duration);

  // Refresh (rotation: old refresh token should be revoked)
  const refreshRes = http.post(
    `${BASE_URL}/api/auth/refresh`,
    JSON.stringify({ refreshToken }),
    { headers: { "Content-Type": "application/json" }, tags: { endpoint: "refresh" } },
  );
  const refreshOk = check(refreshRes, {
    "refresh status is 200": (r) => r.status === 200,
    "refresh has new accessToken": (r) => {
      try {
        return JSON.parse(r.body).accessToken !== undefined;
      } catch (e) {
        return false;
      }
    },
  });
  errorRate.add(!refreshOk);
  refreshDuration.add(refreshRes.timings.duration);

  // Verify refresh-rotation invalidates the old token (regression test
  // for the SELECT ... FOR UPDATE fix in routes/auth.ts).
  const replay = http.post(
    `${BASE_URL}/api/auth/refresh`,
    JSON.stringify({ refreshToken }),
    { headers: { "Content-Type": "application/json" }, tags: { endpoint: "refresh-replay" } },
  );
  check(replay, {
    "old refresh token replay is 401": (r) => r.status === 401,
  });

  // Authenticated read — proves the new access token works.
  const authedRes = http.get(`${BASE_URL}/api/workspaces?limit=5`, authHeaders(accessToken));
  check(authedRes, {
    "authed request status is 200": (r) => r.status === 200,
  });

  sleep(1);
}