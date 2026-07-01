/**
 * Shared auth helper for k6 scripts.
 *
 * Provides:
 *   - registerAndLogin(baseUrl): POSTs /api/auth/register with a unique
 *     email, returns { accessToken, refreshToken, email, password }
 *   - authHeaders(token): returns headers object with bearer token
 *   - login(baseUrl, email, password): re-authenticate an existing user
 *
 * The k6 runtime resolves local ES module imports, so each script does:
 *   import { registerAndLogin, authHeaders } from "./lib/auth.js";
 *
 * Why a dedicated helper instead of inline registration per VU: the
 * scripts run with hundreds of VUs and each register call hits bcrypt
 * at cost 12 — generating a few hundred users upfront in setup() and
 * reusing the credentials in default() keeps the load profile focused
 * on the endpoints under test rather than the auth path.
 */

import http from "k6/http";

const TEST_PASSWORD = "LoadTest123!";

export function uniqueEmail(vu, iter, prefix = "loadtest") {
  return `${prefix}-${vu}-${iter}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@loadtest.local`;
}

export function registerUser(baseUrl, email, password = TEST_PASSWORD) {
  const res = http.post(
    `${baseUrl}/api/auth/register`,
    JSON.stringify({ email, password }),
    { headers: { "Content-Type": "application/json" } },
  );
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`register failed: ${res.status} ${res.body}`);
  }
  const body = JSON.parse(res.body);
  if (!body.accessToken || !body.refreshToken) {
    throw new Error(`register response missing tokens: ${res.body}`);
  }
  return {
    accessToken: body.accessToken,
    refreshToken: body.refreshToken,
    email,
    password,
  };
}

export function login(baseUrl, email, password = TEST_PASSWORD) {
  const res = http.post(
    `${baseUrl}/api/auth/login`,
    JSON.stringify({ email, password }),
    { headers: { "Content-Type": "application/json" } },
  );
  if (res.status !== 200) {
    throw new Error(`login failed: ${res.status} ${res.body}`);
  }
  return JSON.parse(res.body);
}

export function refresh(baseUrl, refreshToken) {
  const res = http.post(
    `${baseUrl}/api/auth/refresh`,
    JSON.stringify({ refreshToken }),
    { headers: { "Content-Type": "application/json" } },
  );
  if (res.status !== 200) {
    throw new Error(`refresh failed: ${res.status} ${res.body}`);
  }
  return JSON.parse(res.body);
}

export function authHeaders(accessToken, extra = {}) {
  return {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      ...extra,
    },
  };
}

/**
 * Provision N test users at setup(). Returns an array of credential
 * objects; VUs pick from it round-robin. Avoids hitting bcrypt on
 * every iteration when the script cares about endpoint latency, not
 * auth latency.
 */
export function provisionUsers(baseUrl, count) {
  const users = [];
  for (let i = 0; i < count; i++) {
    const email = uniqueEmail(0, i, "load");
    users.push(registerUser(baseUrl, email));
  }
  return users;
}