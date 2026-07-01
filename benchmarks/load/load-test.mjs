#!/usr/bin/env node
/**
 * Node.js load test for GET /api/workspaces.
 *
 * Equivalent to k6-read.js — runs N concurrent clients for T seconds,
 * reports p50/p95/p99 latency, throughput, and error rate.
 *
 * Usage:
 *   node benchmarks/load/load-test.js [--url http://localhost:3001] [--vu 50] [--duration 30] [--auth <token>]
 *
 * Targets: p(95) < 1000ms reads, p(95) < 2000ms writes, error rate < 5%.
 */

const args = process.argv.slice(2);
function arg(name, def) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
}

const URL_ = arg("url", "http://localhost:3001");
const VU = parseInt(arg("vu", "50"), 10);
const DURATION_S = parseInt(arg("duration", "30"), 10);
const AUTH = arg("auth", process.env.LOAD_TEST_TOKEN || "");
const PATH_ = arg("path", "/api/workspaces");
const OUTPUT = arg("output", "");
const AUTO_REGISTER = args.includes("--auto-register");

const headers = { "Content-Type": "application/json" };

if (AUTH) {
  headers["Authorization"] = `Bearer ${AUTH}`;
} else if (AUTO_REGISTER) {
  // Provision a single test user for the whole run — sufficient for a
  // smoke test. Don't share the token across VUs in a real load test
  // (use --auth or the k6 scripts with provisionUsers instead).
  const email = `loadtest-${Date.now()}@loadtest.local`;
  const password = "LoadTest123!";
  const reg = await fetch(`${URL_}/api/auth/register`, {
    method: "POST",
    headers,
    body: JSON.stringify({ email, password }),
  });
  if (!reg.ok) {
    console.error(`auto-register failed: ${reg.status} ${await reg.text()}`);
    process.exit(1);
  }
  const body = await reg.json();
  headers["Authorization"] = `Bearer ${body.accessToken}`;
  console.log(`auto-registered ${email}`);
}

const latencies = [];
let errors = 0;
let totalRequests = 0;
let success = 0;
const endTime = Date.now() + DURATION_S * 1000;

function pct(arr, p) {
  if (arr.length === 0) return 0;
  const idx = Math.floor((arr.length - 1) * p);
  return arr[idx];
}

async function requestOnce() {
  const start = Date.now();
  try {
    const res = await fetch(`${URL_}${PATH_}`, { headers });
    await res.text();
    const ms = Date.now() - start;
    latencies.push(ms);
    if (res.status >= 500) errors++;
    else success++;
  } catch (e) {
    errors++;
  }
  totalRequests++;
}

async function vu(id) {
  while (Date.now() < endTime) {
    await requestOnce();
    // no sleep — k6 default is also aggressive; this measures peak throughput
  }
}

console.log(`Load test: ${VU} VUs × ${DURATION_S}s against ${URL_}${PATH_}`);
const startTs = Date.now();
await Promise.all(Array.from({ length: VU }, (_, i) => vu(i)));
const elapsed = (Date.now() - startTs) / 1000;

latencies.sort((a, b) => a - b);
const p50 = pct(latencies, 0.50);
const p95 = pct(latencies, 0.95);
const p99 = pct(latencies, 0.99);
const errRate = totalRequests > 0 ? (errors / totalRequests) * 100 : 0;
const rps = totalRequests / elapsed;

console.log("\n──── Results ──────────────────────────────────");
console.log(`Duration:    ${elapsed.toFixed(1)}s`);
console.log(`Requests:    ${totalRequests} (${success} ok, ${errors} err)`);
console.log(`Throughput:  ${rps.toFixed(1)} req/s`);
console.log(`Error rate:  ${errRate.toFixed(2)}%`);
console.log(`Latency:     p50=${p50}ms  p95=${p95}ms  p99=${p99}ms  max=${latencies[latencies.length - 1] || 0}ms`);

if (OUTPUT) {
  const { writeFile, mkdir } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  await mkdir(dirname(OUTPUT), { recursive: true });
  await writeFile(
    OUTPUT,
    JSON.stringify({
      url: URL_,
      path: PATH_,
      vus: VU,
      durationSeconds: DURATION_S,
      elapsedSeconds: elapsed,
      totalRequests,
      success,
      errors,
      throughput: rps,
      errorRate: errRate,
      latency: { p50, p95, p99, max: latencies[latencies.length - 1] || 0 },
    }, null, 2),
  );
}

const p95Target = 1000;
const errTarget = 5;
if (p95 > p95Target) {
  console.log(`\n❌ FAIL: p95 ${p95}ms > target ${p95Target}ms`);
  process.exit(1);
}
if (errRate > errTarget) {
  console.log(`\n❌ FAIL: error rate ${errRate.toFixed(2)}% > target ${errTarget}%`);
  process.exit(1);
}
console.log(`\n✅ PASS: p95 ${p95}ms ≤ ${p95Target}ms target, error rate ${errRate.toFixed(2)}% ≤ ${errTarget}% target`);
