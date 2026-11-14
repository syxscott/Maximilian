#!/usr/bin/env node
// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Agent Bot — audit round (scripted health sweep, zero LLM dependency).
//
// Emits a markdown report on stdout covering:
//   1. Monorepo type-check results (per package)
//   2. GitHub state: open PRs / issues, latest main CI, recent releases
//   3. Repo vitals: HEAD, branch divergence, worktree cleanliness
//
// The journal step (journal.mjs) posts the report to the bot's issue.
// Failures are collected, never fatal — a degraded section beats a red
// round with no report.

import { execFileSync } from "node:child_process"

const REPO_ROOT = new URL("../..", import.meta.url).pathname

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: 10 * 60_000,
    ...opts,
  })
}

function tryRun(label, cmd, args) {
  try {
    return { label, ok: true, output: run(cmd, args) }
  } catch (err) {
    return { label, ok: false, output: String(err.stderr || err.message || err) }
  }
}

function gh(args) {
  return run("gh", args, { timeout: 60_000 })
}

function tryGh(label, args) {
  try {
    return { label, ok: true, output: gh(args) }
  } catch (err) {
    return { label, ok: false, output: String(err.stderr || err.message || err) }
  }
}

const sections = []

// ── 1. Type-check sweep ──────────────────────────────────────────────────────
process.stdout.write("[audit] type-check sweep...\n")
const typecheck = tryRun("type-check", "pnpm", [
  "--recursive",
  "--filter",
  "@max/*",
  "--filter",
  "./packages/*",
  "run",
  "type-check",
])
sections.push({
  title: "Type-check",
  body: typecheck.ok
    ? "✅ 全部包 `tsc --noEmit` 通过。"
    : `❌ type-check 失败：\n\n\`\`\`\n${typecheck.output.slice(-2000)}\n\`\`\``,
})

// ── 2. GitHub state ──────────────────────────────────────────────────────────
process.stdout.write("[audit] GitHub state...\n")
const prs = tryGh("open PRs", [
  "pr",
  "list",
  "--state",
  "open",
  "--json",
  "number,title,author",
  "--jq",
  '.[] | "#\\(.number) \\(.title) (@\\(.author.login))"',
])
const issues = tryGh("open issues", [
  "issue",
  "list",
  "--state",
  "open",
  "--json",
  "number,title",
  "--jq",
  '.[] | "#\\(.number) \\(.title)"',
])
const ci = tryGh("latest main CI", [
  "run",
  "list",
  "--branch",
  "main",
  "--workflow",
  "ci.yml",
  "--limit",
  "3",
  "--json",
  "conclusion,headSha,createdAt",
  "--jq",
  '.[] | "\\(.headSha[0:7]) \\(.conclusion // "running") \\(.createdAt)"',
])
const releases = tryGh("releases", [
  "release",
  "list",
  "--limit",
  "3",
  "--json",
  "tagName,createdAt",
  "--jq",
  '.[] | "\\(.tagName) \\(.createdAt)"',
])

const ghBody = [
  `- Open PRs: ${prs.ok && prs.output.trim() ? `\n  ${prs.output.trim().split("\n").join("\n  ")}` : "0"}`,
  `- Open issues: ${issues.ok && issues.output.trim() ? `\n  ${issues.output.trim().split("\n").join("\n  ")}` : "0"}`,
  `- Recent main CI:\n  ${ci.ok && ci.output.trim() ? ci.output.trim().split("\n").join("\n  ") : "(gh query failed)"}`,
  `- Recent releases: ${releases.ok && releases.output.trim() ? releases.output.trim().split("\n").join(" · ") : "(unavailable)"}`,
].join("\n")
sections.push({
  title: "GitHub state",
  body:
    prs.ok && issues.ok && ci.ok && releases.ok ? ghBody : `${ghBody}\n\n> ⚠️ 部分 gh 查询失败。`,
})

// ── 3. Repo vitals ───────────────────────────────────────────────────────────
process.stdout.write("[audit] repo vitals...\n")
const head = tryRun("head", "git", ["log", "--oneline", "-1"])
const divergence = tryRun("divergence", "git", [
  "rev-list",
  "--left-right",
  "--count",
  "main...origin/main",
])
const dirty = tryRun("dirty", "git", ["status", "--porcelain"])
const vitals = [
  `- HEAD: ${head.output.trim()}`,
  `- main↔origin divergence: ${divergence.output.trim()} (behind/ahead)`,
  `- worktree: ${dirty.output.trim() === "" ? "clean" : `${dirty.output.trim().split("\n").length} dirty paths`}`,
].join("\n")
sections.push({ title: "Repo vitals", body: vitals })

// ── Emit ─────────────────────────────────────────────────────────────────────
const now = new Date().toISOString()
const allOk = typecheck.ok && prs.ok && issues.ok && ci.ok && releases.ok
console.log(`# 🤖 Agent Bot 巡检轮 — ${now}`)
console.log("")
console.log(`**结论**: ${allOk ? "✅ 正常" : "⚠️ 有异常项（见下）"}`)
console.log("")
for (const s of sections) {
  console.log(`## ${s.title}`)
  console.log("")
  console.log(s.body)
  console.log("")
}
