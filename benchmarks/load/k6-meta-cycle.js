// k6-meta-cycle.js — synthetic baseline for the TruthAudit meta-cycle.
//
// Phase 12 — this script measures how long it takes for the
// MetaOrchestrator to complete one cycle (proposals → promotion →
// recording). It runs against a stub orchestration fixture
// (`benchmarks/load/lib/meta-cycle-fixture.mjs`) so we don't need a
// live Postgres / opencode.
//
// Output: `summary-export=perf-summary-meta.json` with `p95_ms`.
//
// Usage:
//   k6 run --vus 1 --iterations 20 benchmarks/load/k6-meta-cycle.js

import http from "k6/http";
import { check } from "k6";
import { Trend } from "k6/metrics";

const cycleDuration = new Trend("meta_cycle_duration_ms", true);

export const options = {
  vus: 1,
  iterations: 20,
  thresholds: {
    // SLO-5: P95 ≤ 60s. k6 measures in ms so we set 60000.
    "meta_cycle_duration_ms": ["p(95)<60000"],
    "checks": ["rate>0.95"],
  },
};

const BASE_URL = __ENV.BASE_URL || "http://localhost:3001";

export default function () {
  const start = Date.now();
  // The fixture is a Node script we exec via k6's shell — k6 doesn't
  // have native child_process, so we POST to a tiny shim endpoint
  // that the API exposes only when META_CYCLE_FIXTURE=1.
  const res = http.post(`${BASE_URL}/api/admin/perf/meta-cycle`);
  check(res, {
    "status is 200": (r) => r.status === 200,
    "body has cycleMs": (r) => {
      try {
        const body = JSON.parse(r.body as string);
        return typeof body.cycleMs === "number";
      } catch {
        return false;
      }
    },
  });
  cycleDuration.add(Date.now() - start);
}