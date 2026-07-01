#!/usr/bin/env node
/**
 * Phase 9 — Benchmark CLI.
 *
 * Runs benchmark tasks against baseline (single LLM) and/or Maximilian
 * (multi-agent DAGS) and prints an ANSI-colored comparison table.
 *
 * Usage:
 *   npx tsx src/cli.ts --domain=all --mode=both
 *   npx tsx src/cli.ts --domain=database --mode=baseline
 *   npx tsx src/cli.ts --domain=devops --mode=maximilian
 */

import { BenchmarkEvaluator } from "./evaluator.js";
import type { BenchmarkTask, BenchmarkResult, BenchmarkSuiteResult } from "./types.js";

// ── ANSI helpers ─────────────────────────────────────────────────────────────

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const WHITE = "\x1b[37m";
const BG_BLACK = "\x1b[40m";

function color(value: number, thresholds: [number, number] = [0.5, 0.8]): string {
  if (value >= thresholds[1]) return `${GREEN}${value.toFixed(1)}${RESET}`;
  if (value >= thresholds[0]) return `${YELLOW}${value.toFixed(1)}${RESET}`;
  return `${RED}${value.toFixed(1)}${RESET}`;
}

function deltaStr(d: number): string {
  if (d === 0) return `${DIM}—${RESET}`;
  const sign = d > 0 ? "+" : "";
  const c = d > 0 ? GREEN : RED;
  return `${c}${sign}${d.toFixed(1)}${RESET}`;
}

function pad(s: string, width: number): string {
  // Strip ANSI for length calculation.
  const stripped = s.replace(/\x1b\[\d+m/g, "");
  const diff = width - stripped.length;
  return diff > 0 ? s + " ".repeat(diff) : s;
}

// ── Arg parsing ──────────────────────────────────────────────────────────────

interface CliArgs {
  domain: "all" | "database" | "devops" | "frontend";
  mode: "baseline" | "maximilian" | "both";
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { domain: "all", mode: "both" };

  for (const arg of argv) {
    const domainMatch = arg.match(/^--domain=(.+)$/);
    if (domainMatch) {
      const d = domainMatch[1];
      if (d === "all" || d === "database" || d === "devops" || d === "frontend") {
        args.domain = d;
      } else {
        console.error(`Invalid domain: ${d}. Use all|database|devops|frontend`);
        process.exit(1);
      }
    }

    const modeMatch = arg.match(/^--mode=(.+)$/);
    if (modeMatch) {
      const m = modeMatch[1];
      if (m === "baseline" || m === "maximilian" || m === "both") {
        args.mode = m;
      } else {
        console.error(`Invalid mode: ${m}. Use baseline|maximilian|both`);
        process.exit(1);
      }
    }
  }

  return args;
}

// ── Task loading ─────────────────────────────────────────────────────────────

async function loadTasks(domain: CliArgs["domain"]): Promise<BenchmarkTask[]> {
  const tasks: BenchmarkTask[] = [];

  const domains = domain === "all"
    ? ["database", "devops", "frontend"]
    : [domain];

  for (const d of domains) {
    try {
      const mod = await import(`../../../benchmarks/${d}/tasks.js`);
      const exported = Object.values(mod).find((v) => Array.isArray(v)) as BenchmarkTask[] | undefined;
      if (exported) {
        tasks.push(...exported);
      }
    } catch (err) {
      console.error(`Failed to load tasks for domain '${d}':`, err instanceof Error ? err.message : err);
    }
  }

  return tasks;
}

// ── Table rendering ──────────────────────────────────────────────────────────

interface TableRow {
  domain: string;
  taskId: string;
  mode: string;
  quality: number;
  latencyMs: number;
  costTokens: number;
  acceptance: number;
  passed: boolean;
}

function buildTable(rows: TableRow[]): string {
  const cols = [
    { label: "Domain", width: 12, key: "domain" as const },
    { label: "Task ID", width: 30, key: "taskId" as const },
    { label: "Mode", width: 10, key: "mode" as const },
    { label: "Quality", width: 8, key: "quality" as const },
    { label: "Lat ms", width: 8, key: "latencyMs" as const },
    { label: "Tokens", width: 8, key: "costTokens" as const },
    { label: "Accept", width: 8, key: "acceptance" as const },
    { label: "Pass", width: 5, key: "passed" as const },
  ];

  const SEP = `${DIM}│${RESET}`;
  const HLINE = `${DIM}─${RESET}`;

  function hline(left: string, mid: string, right: string): string {
    return `${DIM}${left}${cols.map((c) => HLINE.repeat(c.width + 2)).join(mid)}${right}${RESET}`;
  }

  const lines: string[] = [];

  // Top border.
  lines.push(hline("┌", "┬", "┐"));

  // Header.
  const headerCells = cols.map((c) => ` ${pad(`${BOLD}${WHITE}${c.label}${RESET}`, c.width + 1)} `);
  lines.push(`${SEP}${headerCells.join(SEP)}${SEP}`);

  // Header separator.
  lines.push(hline("├", "┼", "┤"));

  // Data rows.
  for (const row of rows) {
    const cells: string[] = [];
    for (const col of cols) {
      let val: string;
      switch (col.key) {
        case "domain":
          val = `${CYAN}${row.domain}${RESET}`;
          break;
        case "taskId":
          val = row.taskId;
          break;
        case "mode":
          val = row.mode === "baseline" ? `${DIM}base${RESET}` : `${BOLD}maxim${RESET}`;
          break;
        case "quality":
          val = color(row.quality);
          break;
        case "latencyMs":
          val = `${row.latencyMs}`;
          break;
        case "costTokens":
          val = `${row.costTokens}`;
          break;
        case "acceptance":
          val = color(row.acceptance);
          break;
        case "passed":
          val = row.passed ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
          break;
      }
      cells.push(` ${pad(val, col.width + 1)} `);
    }
    lines.push(`${SEP}${cells.join(SEP)}${SEP}`);
  }

  // Bottom border.
  lines.push(hline("└", "┴", "┘"));

  return lines.join("\n");
}

// ── Summary ──────────────────────────────────────────────────────────────────

function printSummary(baseline: BenchmarkSuiteResult | null, maximilian: BenchmarkSuiteResult | null): void {
  console.log(`\n${BOLD}═══ Summary ═══${RESET}\n`);

  if (baseline) {
    const m = baseline.aggregateMetrics;
    console.log(`${BOLD}Baseline:${RESET}  pass=${GREEN}${(m.passRate * 100).toFixed(0)}%${RESET}  quality=${color(m.avgQuality)}  latency=${m.avgLatencyMs.toFixed(0)}ms  tokens=${m.totalTokens}  acceptance=${color(m.avgAcceptance)}`);
  }

  if (maximilian) {
    const m = maximilian.aggregateMetrics;
    console.log(`${BOLD}Maximilian:${RESET} pass=${GREEN}${(m.passRate * 100).toFixed(0)}%${RESET}  quality=${color(m.avgQuality)}  latency=${m.avgLatencyMs.toFixed(0)}ms  tokens=${m.totalTokens}  acceptance=${color(m.avgAcceptance)}`);
  }

  if (baseline && maximilian) {
    const qDelta = maximilian.aggregateMetrics.avgQuality - baseline.aggregateMetrics.avgQuality;
    const aDelta = maximilian.aggregateMetrics.avgAcceptance - baseline.aggregateMetrics.avgAcceptance;
    console.log(`\n${BOLD}Delta:${RESET}      quality=${deltaStr(qDelta)}  acceptance=${deltaStr(aDelta)}`);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  console.log(`\n${BOLD}${BG_BLACK} Maximilian Benchmark Runner ${RESET}\n`);
  console.log(`${DIM}Domain:${RESET} ${args.domain}  ${DIM}Mode:${RESET} ${args.mode}\n`);

  // Load tasks.
  const tasks = await loadTasks(args.domain);
  if (tasks.length === 0) {
    console.error(`${RED}No tasks found for domain '${args.domain}'${RESET}`);
    process.exit(1);
  }
  console.log(`${DIM}Loaded ${tasks.length} task(s)${RESET}\n`);

  // Instantiate evaluator.
  // Provider is injected via deps — the CLI loads it dynamically.
  let provider: import("@max/providers").Provider | undefined;
  try {
    const { getRegistry } = await import("@max/providers");
    const registry = getRegistry();
    const providers = registry.list();
    provider = providers[0];
  } catch {
    // Provider not available — baseline mode will fail gracefully.
  }

  if (!provider && args.mode !== "maximilian") {
    console.error(`${RED}No LLM provider configured. Set OPENAI_API_KEY / ANTHROPIC_API_KEY in .env${RESET}`);
    console.error(`${DIM}Running in maximilian-only mode is not yet supported via CLI.${RESET}`);
    process.exit(1);
  }

  const evaluator = new BenchmarkEvaluator({
    provider: provider!,
    dags: undefined as never, // CLI doesn't run maximilian path yet.
  });

  // Run evaluations.
  let baselineResult: BenchmarkSuiteResult | null = null;
  let maximilianResult: BenchmarkSuiteResult | null = null;

  if (args.mode === "baseline" || args.mode === "both") {
    console.log(`${CYAN}Running baseline evaluation...${RESET}`);
    baselineResult = await evaluator.evaluate(tasks);
  }

  if (args.mode === "maximilian" || args.mode === "both") {
    console.log(`${YELLOW}Running maximilian evaluation...${RESET}`);
    // Maximilian-path evaluation requires a live DAGS graph + AgentRuntime
    // (which itself needs a workspace + provider). Wiring that through the
    // CLI is a planned follow-up; for now we skip with a clear message and
    // let baseline numbers stand alone. See `BenchmarkEvaluator.maximilian`.
    console.log(`${YELLOW}Maximilian mode not yet wired in CLI — skipping.${RESET}`);
  }

  // Build table rows.
  const rows: TableRow[] = [];

  if (baselineResult) {
    for (const r of baselineResult.results) {
      const task = tasks.find((t) => t.id === r.taskId);
      rows.push({
        domain: task?.domain ?? "?",
        taskId: r.taskId,
        mode: "baseline",
        quality: r.quality,
        latencyMs: r.latencyMs,
        costTokens: r.tokenUsage.total,
        acceptance: r.acceptanceScore,
        passed: r.passed,
      });
    }
  }

  if (maximilianResult) {
    const res = maximilianResult as BenchmarkSuiteResult;
    for (const r of res.results) {
      const task = tasks.find((t) => t.id === r.taskId);
      rows.push({
        domain: task?.domain ?? "?",
        taskId: r.taskId,
        mode: "maxim",
        quality: r.quality,
        latencyMs: r.latencyMs,
        costTokens: r.tokenUsage.total,
        acceptance: r.acceptanceScore,
        passed: r.passed,
      });
    }
  }

  // Print table.
  if (rows.length > 0) {
    console.log(`\n${buildTable(rows)}`);
  }

  // Print summary.
  printSummary(baselineResult, maximilianResult as BenchmarkSuiteResult | null);

  // Print errors if any.
  const allResults = [
    ...(baselineResult?.results ?? []),
    ...((maximilianResult as BenchmarkSuiteResult | null)?.results ?? []),
  ];
  const errors = allResults.filter((r) => r.error);
  if (errors.length > 0) {
    console.log(`\n${BOLD}${RED}═══ Errors ═══${RESET}\n`);
    for (const r of errors) {
      console.log(`${RED}${r.taskId}:${RESET} ${r.error}`);
    }
  }

  console.log("");
}

main().catch((err) => {
  console.error(`${RED}Fatal:${RESET}`, err);
  process.exit(1);
});
