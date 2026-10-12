// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Prompt-surface snapshot review gate (hermes ae3598c7cd borrowing).
 *
 * A one-line change to a role's system prompt or a builtin tool's schema
 * rewrites what a model reads before the first user message — without the
 * diff showing it as prompt text. This renders the model-facing surface of
 * every built-in role (system prompt + the tools[] array exactly as
 * `toToolDefinition` sends it, filtered through the role registry's
 * allowed/denied logic) through the PRODUCTION code into the committed
 * fixtures under scripts/fixtures/prompt-surface/:
 *
 *   pnpm prompt-surface:check    # fail when the committed render is stale
 *   tsx scripts/prompt-surface.ts --update   # regenerate the snapshot
 *
 * The render is deterministic by construction: roles and tools are static
 * production constants (no clock, env, network or machine paths enter the
 * bytes), keys are sorted, and the manifest carries token counts
 * (chars/4) so review sees the size of the change, not just its text.
 *
 * Deep-import note: this script imports the packages' public ENTRY files
 * by relative path (root package.json has no @max/* dependencies, so
 * package specifiers do not resolve from scripts/), which is the same
 * surface the architecture policy's forbidDeepImports rule protects.
 */

import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { BUILT_IN_ROLES, DefaultRoleRegistry } from "../packages/agents/src/index.ts"
import { BUILTIN_TOOLS } from "../packages/tools/src/index.ts"
import { toToolDefinition } from "../packages/llm/src/tool.ts"
import type { ToolDefinition } from "../packages/llm/src/messages.ts"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const SNAPSHOT = path.join(ROOT, "scripts", "fixtures", "prompt-surface")
/** Same rough estimate the hermes reference uses; kept local so the script needs no deps. */
const CHARS_PER_TOKEN = 4

/** Representative surfaces: every built-in role × its default toolset. */
const SURFACES = Object.keys(BUILT_IN_ROLES).sort()

function tokenCount(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

/** The tools[] one role's surface sends: production definitions, stable order. */
function toolsForRole(registry: DefaultRoleRegistry, roleId: string): ToolDefinition[] {
  return registry
    .getAllowedTools(roleId)
    .filter((name) => Object.hasOwn(BUILTIN_TOOLS, name))
    .sort()
    .map((name) => toToolDefinition(BUILTIN_TOOLS[name]!))
}

function renderPrompt(roleId: string, systemPrompt: string, tools: ToolDefinition[]): string {
  const lines = [
    `# maximilian prompt surface`,
    `# role: ${roleId}`,
    `# pinned render: no clock, env or machine state enters these bytes`,
    ``,
    `===== system prompt =====`,
    systemPrompt,
    ``,
    `===== tools (${tools.length}) =====`,
  ]
  for (const tool of tools) {
    lines.push(`- ${tool.name}: ${tool.description}`)
  }
  return lines.join("\n") + "\n"
}

interface RenderedSurface {
  prompt: string
  tools: ToolDefinition[]
}

export function renderAll(): Map<string, RenderedSurface> {
  const registry = new DefaultRoleRegistry()
  const rendered = new Map<string, RenderedSurface>()
  for (const roleId of SURFACES) {
    const role = registry.get(roleId)
    if (!role) throw new Error(`built-in role "${roleId}" missing from the registry`)
    const tools = toolsForRole(registry, roleId)
    rendered.set(roleId, {
      prompt: renderPrompt(roleId, role.systemPrompt, tools),
      tools,
    })
  }
  return rendered
}

/**
 * Snapshot layout: one text file per surface prompt; each tool schema once
 * (tools/<name>.json), with a tools/<name>.<surface>.json copy only where a
 * surface serves a different schema — so a description edit is one hunk in
 * review rather than one per surface.
 */
async function writeSnapshot(out: string, rendered: Map<string, RenderedSurface>): Promise<void> {
  await rm(out, { recursive: true, force: true })
  await mkdir(path.join(out, "prompts"), { recursive: true })
  await mkdir(path.join(out, "tools"), { recursive: true })
  const surfaces: Record<string, unknown> = {}
  const toolVariants = new Map<string, Map<string, string>>()
  for (const roleId of SURFACES) {
    const surface = rendered.get(roleId)
    if (!surface) throw new Error(`surface ${roleId} not rendered`)
    await writeFile(path.join(out, "prompts", `${roleId}.txt`), surface.prompt, "utf-8")
    for (const tool of surface.tools) {
      // Deterministic key order: the ToolDefinition's own field order,
      // which is frozen by makeTool — stable across runs.
      const bytes = JSON.stringify(tool, null, 2) + "\n"
      const bySurface = toolVariants.get(tool.name) ?? new Map<string, string>()
      bySurface.set(roleId, bytes)
      toolVariants.set(tool.name, bySurface)
    }
    surfaces[roleId] = {
      promptTokens: tokenCount(surface.prompt),
      toolTokens: tokenCount(JSON.stringify(surface.tools)),
      tools: surface.tools.map((t) => t.name),
    }
  }
  for (const [name, bySurface] of [...toolVariants.entries()].sort()) {
    const variants = new Map<string, string>([...bySurface.entries()].sort())
    const common = [...variants.values()][0]!
    await writeFile(path.join(out, "tools", `${name}.json`), common, "utf-8")
    for (const [surface, bytes] of variants) {
      if (bytes !== common) {
        await writeFile(path.join(out, "tools", `${name}.${surface}.json`), bytes, "utf-8")
      }
    }
  }
  await writeFile(
    path.join(out, "surfaces.json"),
    JSON.stringify({ surfaces }, null, 2) + "\n",
    "utf-8",
  )
}

async function entriesOf(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return []
  const files: string[] = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await entriesOf(full)).map((f) => path.join(entry.name, f)))
    } else {
      files.push(entry.name)
    }
  }
  return files.sort()
}

async function checkSnapshot(rendered: Map<string, RenderedSurface>): Promise<number> {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "prompt-surface-check-"))
  try {
    await writeSnapshot(tmp, rendered)
    const committed = await entriesOf(SNAPSHOT)
    const fresh = await entriesOf(tmp)
    const missing = committed.filter((f) => !fresh.includes(f))
    const extra = fresh.filter((f) => !committed.includes(f))
    const changed: string[] = []
    for (const file of committed.filter((f) => fresh.includes(f))) {
      const before = await readFile(path.join(SNAPSHOT, file), "utf-8")
      const after = await readFile(path.join(tmp, file), "utf-8")
      if (before !== after) changed.push(file)
    }
    if (missing.length === 0 && extra.length === 0 && changed.length === 0) {
      console.log(
        `prompt surface: ok (${SURFACES.length} surfaces, ${committed.length} fixture files)`,
      )
      return 0
    }
    console.error("prompt surface: the committed snapshot is STALE — the model-facing")
    console.error("surface changed without its fixture diff. Review the change, then run:")
    console.error("  pnpm prompt-surface:check --update")
    for (const file of changed) console.error(`  modified: ${file}`)
    for (const file of missing) console.error(`  missing (tool removed?): ${file}`)
    for (const file of extra) console.error(`  new: ${file}`)
    return 1
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
}

async function main(argv: string[]): Promise<number> {
  const update = argv.includes("--update")
  const rendered = renderAll()
  if (update) {
    await writeSnapshot(SNAPSHOT, rendered)
    console.log(
      `prompt surface: rendered ${SURFACES.length} surfaces into ${path.relative(ROOT, SNAPSHOT)}`,
    )
    return 0
  }
  return checkSnapshot(rendered)
}

const invokedDirectly = import.meta.url === `file://${path.resolve(process.argv[1] ?? "")}`
if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exit(code)
    })
    .catch((err) => {
      console.error(err instanceof Error ? err.message : String(err))
      process.exit(1)
    })
}
