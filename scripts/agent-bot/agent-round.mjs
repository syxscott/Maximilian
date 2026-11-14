#!/usr/bin/env node
// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Agent Bot — agent round: boot the runtime, submit a bounded goal through
// POST /api/chat, poll the workspace to completion, emit the agent's own
// report. In-process queue mode (no Redis needed for a single round).
//
// Honest degradation: without a real provider key the round refuses to
// pretend — it emits a setup notice instead of a fabricated report.
//
// Env: DATABASE_URL, JWT_SECRET, OPENAI_API_KEY (real key required),
//      BOT_GOAL (optional goal override), GH run context unused here.

import { execFileSync, spawn } from "node:child_process"
import { appendFileSync, writeFileSync } from "node:fs"

const REPO_ROOT = new URL("../..", import.meta.url).pathname
const API = "http://localhost:3001"
const POLL_INTERVAL_MS = 15_000
const ROUND_BUDGET_MS = 25 * 60_000

const DEFAULT_GOAL =
  "巡检本仓库：运行 pnpm type-check 与 pnpm --filter @max/core test，" +
  "查看最近 5 条提交的主题，写一份不超过 500 字的健康简报（不要修改任何文件）。"

const goal = (process.env.BOT_GOAL ?? "").trim() || DEFAULT_GOAL
const hasProviderKey = Boolean(
  process.env.OPENAI_API_KEY && !process.env.OPENAI_API_KEY.includes("fake"),
)

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { cwd: REPO_ROOT, encoding: "utf8", ...opts })
}

function emit(body) {
  // The workflow redirects stdout to agent-bot-report.md.
  console.log(body)
}

if (!hasProviderKey) {
  emit("# 🤖 Agent Bot 代理轮 — 跳过")
  emit("")
  emit("**未配置真实的 LLM provider key**（repo secrets 无 `OPENAI_API_KEY`）。")
  emit("代理轮需要真实推理能力，本 round 按设计拒绝空转——不伪造报告。")
  emit("")
  emit("启用方式：repo Settings → Secrets and variables → Actions 添加")
  emit("`OPENAI_API_KEY`（或改用其他 provider 并同步修改本 workflow 的 env），")
  emit("然后在 Actions → Agent Bot → Run workflow 手动重跑 `agent` 轮。")
  process.exit(0)
}

// ── Boot API (in-process mode: no Redis needed for a single round) ──────────
process.stdout.write("[agent-round] building + starting API...\n")
sh("pnpm", ["--filter", "@max/api", "build"])
sh("pnpm", ["--filter", "@max/database", "build"])
sh("node", ["scripts/migrate.mjs"])

const api = spawn("pnpm", ["--filter", "@max/api", "start"], {
  cwd: REPO_ROOT,
  env: { ...process.env, NODE_ENV: "production" },
  stdio: ["ignore", "pipe", "pipe"],
})
const apiLog = []
const API_LOG = new URL("../../api.log", import.meta.url)
writeFileSync(API_LOG, "")
function captureApiLog(d) {
  const text = String(d)
  apiLog.push(text)
  appendFileSync(API_LOG, text)
}
api.stdout.on("data", captureApiLog)
api.stderr.on("data", captureApiLog)

async function waitForReady() {
  for (let i = 0; i < 90; i++) {
    try {
      const res = await fetch(`${API}/api/ready`)
      if (res.ok) return
    } catch {
      /* not up yet */
    }
    await sleep(1000)
  }
  throw new Error("API never became ready — see api.log artifact")
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

// ── Auth (same registration path the load test uses) ────────────────────────
async function login() {
  const creds = {
    email: "agent-bot@maximilian.local",
    password: "agent-bot-round-password",
    name: "agent-bot",
  }
  const reg = await fetch(`${API}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(creds),
  })
  let token = reg.ok ? (await reg.json()).accessToken : undefined
  if (!token) {
    const login = await fetch(`${API}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: creds.email, password: creds.password }),
    })
    token = login.ok ? (await login.json()).accessToken : undefined
  }
  if (!token) throw new Error("could not register or login the bot user")
  return token
}

// ── Round ────────────────────────────────────────────────────────────────────
async function main() {
  await waitForReady()
  process.stdout.write("[agent-round] API ready; submitting goal\n")
  const token = await login()
  const auth = { authorization: `Bearer ${token}`, "content-type": "application/json" }

  const submit = await fetch(`${API}/api/chat`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ message: goal }),
  })
  if (!submit.ok) {
    throw new Error(`POST /api/chat failed: ${submit.status} ${await submit.text()}`)
  }
  const { workspaceId } = await submit.json()
  process.stdout.write(`[agent-round] workspace ${workspaceId}\n`)

  const deadline = Date.now() + ROUND_BUDGET_MS
  let workspace
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS)
    const res = await fetch(`${API}/api/workspaces/${workspaceId}`, { headers: auth })
    if (!res.ok) continue
    workspace = await res.json()
    process.stdout.write(`[agent-round] status: ${workspace.status}\n`)
    if (workspace.status === "completed" || workspace.status === "failed") break
  }
  if (!workspace || (workspace.status !== "completed" && workspace.status !== "failed")) {
    throw new Error(`workspace ${workspaceId} did not settle within the round budget`)
  }

  const results = Array.isArray(workspace.results) ? workspace.results : []
  emit(`# 🤖 Agent Bot 代理轮 — ${new Date().toISOString()}`)
  emit("")
  emit(`- **Goal**: ${goal}`)
  emit(`- **Workspace**: \`${workspaceId}\` · **Status**: ${workspace.status}`)
  emit(`- **Rounds/tasks**: ${results.length} result(s)`)
  emit("")
  for (const r of results) {
    const text = String(r.output ?? "").trim()
    emit(`## ${r.agentRole ?? "agent"} — ${r.status ?? ""}`)
    emit("")
    emit(text ? text.slice(0, 6000) : "(empty output)")
    emit("")
  }
  if (workspace.status === "failed") {
    process.exitCode = 1
  }
}

main()
  .catch((err) => {
    emit(`# 🤖 Agent Bot 代理轮 — 失败`)
    emit("")
    emit(`\`\`\`\n${String(err.stack || err).slice(0, 3000)}\n\`\`\``)
    emit("")
    emit("API log tail:")
    emit("```")
    emit(apiLog.slice(-4000).join(""))
    emit("```")
    process.exitCode = 1
  })
  .finally(() => {
    api.kill("SIGTERM")
  })
