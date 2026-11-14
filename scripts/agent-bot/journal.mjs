#!/usr/bin/env node
// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Agent Bot — journal step: upsert the bot's journal issue on GitHub.
// One rolling issue ("🤖 Agent Bot Journal") collects one comment per
// round; created on first round. `--dry-run` prints the intended GitHub
// calls instead of executing them (local verification).
//
// Flags: --round audit|agent  --status success|failure
//        --run-url <url>      --report-file <path>

import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"

const ISSUE_TITLE = "🤖 Agent Bot Journal"
const MAX_REPORT_CHARS = 6000

function arg(name) {
  const i = process.argv.indexOf(name)
  return i !== -1 ? process.argv[i + 1] : undefined
}

const round = arg("--round") ?? "audit"
const status = arg("--status") ?? "success"
const runUrl = arg("--run-url") ?? "(no run url)"
const reportFile = arg("--report-file")
const dryRun = process.argv.includes("--dry-run")

const report = reportFile ? readFileSync(reportFile, "utf8") : "(no report produced)"
const truncated =
  report.length > MAX_REPORT_CHARS
    ? `${report.slice(0, MAX_REPORT_CHARS)}\n\n…(truncated — full report in the run artifact)`
    : report

const icon = status === "success" ? "✅" : "❌"
const body = [
  `## ${icon} ${round} round — ${new Date().toISOString()}`,
  "",
  `- Run: ${runUrl}`,
  `- Status: ${status}`,
  "",
  "<details>",
  "<summary>Round report</summary>",
  "",
  truncated,
  "",
  "</details>",
].join("\n")

function gh(args) {
  if (dryRun) {
    console.log(`[dry-run] gh ${args.join(" ")}`)
    console.log(`[dry-run] body preview:\n${body.slice(0, 400)}…`)
    return undefined
  }
  return execFileSync("gh", args, { encoding: "utf8" })
}

const existing = gh([
  "issue",
  "list",
  "--state",
  "open",
  "--search",
  `${ISSUE_TITLE} in:title`,
  "--json",
  "number",
  "--jq",
  ".[0].number",
])
const issueNumber =
  typeof existing === "string" && existing.trim() !== "" ? existing.trim() : undefined

if (issueNumber) {
  gh(["issue", "comment", issueNumber, "--body", body])
  console.log(`[journal] commented on #${issueNumber}`)
} else {
  gh([
    "issue",
    "create",
    "--title",
    ISSUE_TITLE,
    "--body",
    [
      "Rolling journal for the [Agent Bot](../actions/workflows/agent-bot.yml) autonomous",
      "rounds — one comment per round (audit sweep / agent goal).",
      "Created automatically; safe to close, the next round reopens it.",
      "",
      body,
    ].join("\n"),
  ])
  console.log("[journal] created the journal issue")
}
