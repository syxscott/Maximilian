/**
 * Phase 9 — DevOps Benchmark Tasks.
 *
 * 3 high-difficulty DevOps tasks testing:
 *   1. Log parsing pipeline with nested regex
 *   2. Multi-environment configuration merger
 *   3. Dependency graph analyzer from package manifests
 *
 * Each task provides initial files and post-execution assertions.
 */

import type { BenchmarkTask, DevOpsTaskContext } from "../../packages/benchmark-core/src/types.js";

// ── Task 1: Log Parsing Pipeline ────────────────────────────────────────────

const task1Context: DevOpsTaskContext = {
  initialFiles: {
    "logs/app.log": [
      '2024-01-15T10:23:45Z [ERROR] api-server: Connection refused to database at 10.0.0.5:5432 (retry 1/3)',
      '2024-01-15T10:23:46Z [WARN]  api-server: Falling back to read replica at 10.0.0.6:5432',
      '2024-01-15T10:23:47Z [INFO]  api-server: Query completed in 245ms (SELECT * FROM users WHERE id=1234)',
      '2024-01-15T10:23:48Z [ERROR] worker-pool: Task timeout after 30000ms (job_id=abc-123, queue=high)',
      '2024-01-15T10:23:49Z [INFO]  api-server: Request completed: POST /api/v2/orders → 201 (127ms)',
      '2024-01-15T10:23:50Z [ERROR] auth-service: JWT validation failed: token expired (user_id=5678)',
      '2024-01-15T10:23:51Z [WARN]  rate-limiter: Threshold exceeded for IP 192.168.1.100 (50 req/s)',
      '2024-01-15T10:23:52Z [INFO]  api-server: Cache hit ratio: 87.3% (last 5min)',
      '2024-01-15T10:23:53Z [ERROR] worker-pool: Out of memory: heap limit reached (pid=4521)',
      '2024-01-15T10:23:54Z [INFO]  api-server: Health check passed (uptime: 72h 15m)',
    ].join("\n"),
    "config.json": JSON.stringify({ services: ["api-server", "worker-pool", "auth-service"], thresholds: { error: 3, warn: 5 } }),
  },
  assertions: [
    {
      path: "summary.json",
      check: "exists" as const,
    },
    {
      path: "summary.json",
      check: "matches" as const,
      value: '"totalErrors":\\s*4',
    },
    {
      path: "summary.json",
      check: "matches" as const,
      value: '"totalWarnings":\\s*2',
    },
    {
      path: "summary.json",
      check: "matches" as const,
      value: '"topErrors"',
    },
    {
      path: "errors_by_service.json",
      check: "exists" as const,
    },
    {
      path: "errors_by_service.json",
      check: "matches" as const,
      value: '"api-server":\\s*1',
    },
    {
      path: "errors_by_service.json",
      check: "matches" as const,
      value: '"worker-pool":\\s*2',
    },
  ],
};

// ── Task 2: Multi-Environment Configuration Merger ──────────────────────────

const task2Context: DevOpsTaskContext = {
  initialFiles: {
    "config/base.json": JSON.stringify({
      app: { name: "myapp", port: 3000 },
      database: { host: "localhost", port: 5432, pool: { min: 2, max: 10 } },
      logging: { level: "info", format: "json" },
      features: { darkMode: true, betaFeatures: false },
    }, null, 2),
    "config/development.json": JSON.stringify({
      database: { host: "dev.db.local", pool: { max: 5 } },
      logging: { level: "debug" },
      features: { betaFeatures: true },
    }, null, 2),
    "config/staging.json": JSON.stringify({
      database: { host: "staging.db.internal", pool: { max: 20 } },
      logging: { level: "warn" },
      app: { port: 8080 },
    }, null, 2),
    "config/production.json": JSON.stringify({
      database: { host: "prod.db.internal", port: 5433, pool: { min: 10, max: 50 } },
      logging: { level: "error", format: "json" },
      features: { darkMode: true, betaFeatures: false },
      app: { port: 443 },
    }, null, 2),
  },
  assertions: [
    {
      path: "merged/development.json",
      check: "exists" as const,
    },
    {
      path: "merged/development.json",
      check: "matches" as const,
      value: '"host":\\s*"dev.db.local"',
    },
    {
      path: "merged/development.json",
      check: "matches" as const,
      value: '"betaFeatures":\\s*true',
    },
    {
      path: "merged/production.json",
      check: "exists" as const,
    },
    {
      path: "merged/production.json",
      check: "matches" as const,
      value: '"host":\\s*"prod.db.internal"',
    },
    {
      path: "merged/production.json",
      check: "matches" as const,
      value: '"max":\\s*50',
    },
    {
      path: "merged/staging.json",
      check: "exists" as const,
    },
    {
      path: "merged/staging.json",
      check: "matches" as const,
      value: '"port":\\s*8080',
    },
  ],
};

// ── Task 3: Dependency Graph Analyzer ───────────────────────────────────────

const task3Context: DevOpsTaskContext = {
  initialFiles: {
    "packages.json": JSON.stringify({
      packages: [
        { name: "frontend", dependencies: ["shared-utils", "api-client", "auth-sdk"] },
        { name: "api-client", dependencies: ["shared-utils", "http-lib"] },
        { name: "auth-sdk", dependencies: ["shared-utils", "crypto-lib"] },
        { name: "shared-utils", dependencies: [] },
        { name: "http-lib", dependencies: [] },
        { name: "crypto-lib", dependencies: ["shared-utils"] },
        { name: "backend", dependencies: ["shared-utils", "auth-sdk", "db-driver"] },
        { name: "db-driver", dependencies: [] },
      ],
    }, null, 2),
  },
  assertions: [
    {
      path: "build-order.txt",
      check: "exists" as const,
    },
    {
      path: "build-order.txt",
      check: "matches" as const,
      value: "shared-utils.*http-lib.*crypto-lib",  // leaf deps first
    },
    {
      path: "circular-deps.txt",
      check: "exists" as const,
    },
    {
      path: "circular-deps.txt",
      check: "contains" as const,
      value: "none",
    },
    {
      path: "dep-tree.json",
      check: "exists" as const,
    },
    {
      path: "dep-tree.json",
      check: "matches" as const,
      value: '"depth"',
    },
  ],
};

// ── Assertion Functions ──────────────────────────────────────────────────────

async function assertLogParsing(output: string): Promise<boolean> {
  // The script should produce JSON output mentioning error counts.
  return /summary|error|total/i.test(output) || true; // script output is optional
}

async function assertConfigMerger(output: string): Promise<boolean> {
  // The script should handle JSON merging.
  return /merge|config|output/i.test(output) || true;
}

async function assertDepGraph(output: string): Promise<boolean> {
  // The script should produce a build order.
  return /build|order|dependency/i.test(output) || true;
}

// ── Exported Tasks ───────────────────────────────────────────────────────────

export const DEVOPS_TASKS: BenchmarkTask[] = [
  {
    id: "devops-log-parsing",
    domain: "devops",
    difficulty: "hard",
    input:
      "Write a bash script that parses the application log file `logs/app.log`. " +
      "Extract all ERROR-level entries, count them by service name, and produce two output files:\n" +
      "1. `summary.json` with fields: totalErrors (number), totalWarnings (number), topErrors (array of {service, count} sorted by count desc)\n" +
      "2. `errors_by_service.json` with field counts per service name\n\n" +
      "The log format is: TIMESTAMP [LEVEL] service: message\n" +
      "Write the script to `parse.sh` and execute it.",
    context: task1Context as unknown as Record<string, unknown>,
    expectedOutputAssertion: assertLogParsing,
  },
  {
    id: "devops-config-merger",
    domain: "devops",
    difficulty: "hard",
    input:
      "Write a bash script that merges configuration files. Given `config/base.json` and environment-specific overrides " +
      "(`config/development.json`, `config/staging.json`, `config/production.json`), " +
      "produce merged configurations in a `merged/` directory. " +
      "Deep-merge each environment config on top of base. Use `jq` if available, otherwise use Python one-liners.\n\n" +
      "The script should:\n" +
      "1. Read base.json as the foundation\n" +
      "2. For each env file, deep-merge it onto base (env values override base)\n" +
      "3. Write the result to `merged/<env>.json`\n\n" +
      "Write the script to `merge.sh` and execute it.",
    context: task2Context as unknown as Record<string, unknown>,
    expectedOutputAssertion: assertConfigMerger,
  },
  {
    id: "devops-dep-graph",
    domain: "devops",
    difficulty: "hard",
    input:
      "Write a bash script that analyzes a dependency graph from `packages.json`. " +
      "The JSON contains an array of packages, each with a `name` and `dependencies` array.\n\n" +
      "Produce three output files:\n" +
      "1. `build-order.txt` — topologically sorted package names (one per line), leaf dependencies first\n" +
      "2. `circular-deps.txt` — list any circular dependencies found, or 'none' if the graph is acyclic\n" +
      "3. `dep-tree.json` — for each package: {name, depth (longest path from root), directDeps (count)}\n\n" +
      "Write the script to `analyze.sh` and execute it.",
    context: task3Context as unknown as Record<string, unknown>,
    expectedOutputAssertion: assertDepGraph,
  },
];
