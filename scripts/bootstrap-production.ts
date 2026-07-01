/**
 * Production seed bootstrapper.
 *
 * Seeds the initial BlueprintStore with 4 foundational base agents
 * needed to pass the Phase 9 Benchmark suites.
 *
 * Usage: npx tsx scripts/bootstrap-production.ts
 */

import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { BlueprintStore, newBlueprintId, emptyStats } from "@max/dags";
import type { AgentBlueprint } from "@max/dags";

// Resolve the same root the API uses: WORKSPACE_DIR or default ./workspaces.
const DATA_DIR = process.env.WORKSPACE_DIR ?? join(process.cwd(), "workspaces");

// ── Environment check ─────────────────────────────────────────────────────

const REQUIRED_ENV = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "DEEPSEEK_API_KEY"];
const missing = REQUIRED_ENV.filter((k) => !process.env[k]);

if (missing.length > 0) {
  console.error("\n  Missing required environment variables:\n");
  for (const k of missing) console.error(`    - ${k}`);
  console.error(
    "\n  Create a .env file in the project root:\n" +
      "\n    OPENAI_API_KEY=sk-..." +
      "\n    ANTHROPIC_API_KEY=sk-ant-..." +
      "\n    DEEPSEEK_API_KEY=sk-..." +
      "\n",
  );
  process.exit(1);
}

// ── Setup ──────────────────────────────────────────────────────────────────

if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
}

const store = new BlueprintStore(DATA_DIR);

// ── Blueprint definitions ──────────────────────────────────────────────────

interface SeedDef {
  role: string;
  displayName: string;
  goal: string;
  systemPrompt: string;
  capabilities: string[];
  preferredModels: Array<{ provider: string; model: string; reason: string }>;
  constraints: AgentBlueprint["constraints"];
}

const SEEDS: SeedDef[] = [
  {
    role: "product_agent",
    displayName: "Product Agent",
    goal: "Analyze user requirements and produce clear PRDs with technical specifications.",
    systemPrompt:
      "You are a senior product manager agent. Your job is to analyze user requests, " +
      "break them down into clear requirements, define acceptance criteria, and produce " +
      "a structured PRD (Product Requirements Document). Always think in terms of user " +
      "value, edge cases, and technical feasibility. Output structured markdown.",
    capabilities: ["requirements_analysis", "prd_generation", "user_story_decomposition"],
    preferredModels: [
      { provider: "anthropic", model: "claude-sonnet-4-6", reason: "Best reasoning for requirements analysis" },
    ],
    constraints: { outputFormat: "markdown" },
  },
  {
    role: "database_agent",
    displayName: "Database Agent",
    goal: "Design database schemas, write migrations, and optimize queries.",
    systemPrompt:
      "You are a senior database engineer agent. Your job is to design normalized " +
      "database schemas, write migration scripts, optimize query performance, and ensure " +
      "data integrity. You work with PostgreSQL and SQLite. Always consider indexes, " +
      "foreign keys, and migration reversibility. Output valid SQL code.",
    capabilities: ["schema_design", "migration_writing", "query_optimization"],
    preferredModels: [
      { provider: "openai", model: "gpt-4o", reason: "Strong SQL generation capabilities" },
    ],
    constraints: { outputFormat: "code", mustIncludeCodeBlocks: true },
  },
  {
    role: "devops_agent",
    displayName: "DevOps Agent",
    goal: "Write Dockerfiles, CI/CD configs, and deployment scripts.",
    systemPrompt:
      "You are a senior DevOps engineer agent. Your job is to write Dockerfiles, " +
      "docker-compose configurations, GitHub Actions workflows, and deployment scripts. " +
      "You follow security best practices, minimize image sizes, and ensure reproducible " +
      "builds. Always use multi-stage builds and non-root users. Output valid YAML/Dockerfile code.",
    capabilities: ["containerization", "cicd_pipeline", "deployment_automation"],
    preferredModels: [
      { provider: "deepseek", model: "deepseek-coder", reason: "Cost-effective for infrastructure code" },
    ],
    constraints: { outputFormat: "code", mustIncludeCodeBlocks: true },
  },
  {
    role: "reviewer_agent",
    displayName: "Reviewer Agent",
    goal: "Perform code reviews, security audits, and quality scoring.",
    systemPrompt:
      "You are a senior code reviewer agent. Your job is to review code for correctness, " +
      "security vulnerabilities, performance issues, and adherence to best practices. " +
      "You provide actionable feedback with specific line references. You score code " +
      "quality on a 0-10 scale. Always check for OWASP top 10 vulnerabilities. " +
      "Output structured JSON with issues, suggestions, and a quality score.",
    capabilities: ["code_review", "security_audit", "quality_scoring"],
    preferredModels: [
      { provider: "anthropic", model: "claude-sonnet-4-6", reason: "Best analysis for thorough code review" },
    ],
    constraints: { outputFormat: "json" },
  },
];

// ── Seed blueprints ────────────────────────────────────────────────────────

async function main() {
  console.log("\n  Maximilian — Production Bootstrap\n");
  console.log(`  Data directory: ${DATA_DIR}\n`);

  // Check for existing ACTIVE blueprints to make the script idempotent.
  // Use findByRole (filters out retired) instead of listAll (includes retired)
  // so that re-seeding works after a blueprint has been retired.
  const ids: string[] = [];

  for (const def of SEEDS) {
    const existing = await store.findByRole(def.role);
    if (existing.length > 0) {
      console.log(`  [skip] ${def.displayName.padEnd(16)} → already exists (${existing[0].id})`);
      continue;
    }

    const now = new Date().toISOString();
    const id = newBlueprintId(def.role);
    const blueprint: AgentBlueprint = {
      id,
      role: def.role,
      displayName: def.displayName,
      goal: def.goal,
      systemPrompt: def.systemPrompt,
      capabilities: def.capabilities,
      tools: [],
      preferredModels: def.preferredModels,
      constraints: def.constraints,
      version: "v1",
      createdAt: now,
      updatedAt: now,
      stats: emptyStats(),
      metadata: {},
    };

    await store.save(blueprint);
    ids.push(id);
    console.log(`  [ok]   ${def.displayName.padEnd(16)} → ${id}`);
  }

  if (ids.length === 0) {
    console.log("\n  All foundational blueprints already present. Nothing to seed.\n");
  } else {
    console.log(`\n  Seeded ${ids.length} new blueprint(s).\n`);
  }

  console.log("  Next steps:");
  console.log("    1. Start everything: pnpm start:all");
  console.log("    2. Open dashboard:   http://localhost:5174\n");
}

main().catch((err) => {
  console.error("Bootstrap failed:", err);
  process.exit(1);
});
