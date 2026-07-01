/**
 * SKILL.md loader — progressive disclosure for user/system skills.
 *
 * Inspired by hermes-agent's SKILL.md format: a skill is a directory
 * containing a `SKILL.md` with YAML frontmatter (name, description,
 * triggers, optional version) and a Markdown body. The loader reads
 * the frontmatter eagerly but only reads the body on demand, so the
 * runtime can decide whether to inject the full skill into the prompt.
 *
 * Frontmatter shape (minimal):
 *   ---
 *   name: web-search
 *   description: Search the web for up-to-date information.
 *   triggers: ["search:", "find:"]
 *   version: 1
 *   ---
 *
 * Body is plain Markdown.
 */

import { promises as fs } from "node:fs"
import path from "node:path"

export type SkillFrontmatter = {
  name: string
  description?: string
  triggers?: string[]
  version?: number | string
  /**
   * Tools the runtime is allowed to call while this skill is active.
   * Mirrors Claude Code's `allowed-tools` frontmatter — when set, the
   * runtime should restrict tool dispatch to this allowlist for any
   * task matched to this skill. Undefined = no restriction.
   */
  allowedTools?: string[]
  /**
   * When true, the skill can ONLY be invoked by the user (e.g. a slash
   * command). Mirrors Claude Code's `disable-model-invocation`. The
   * runtime skips model-driven matching for these skills so the agent
   * loop never injects them based on heuristic triggers.
   */
  disableModelInvocation?: boolean
  /** Free-form extra fields preserved verbatim. */
  extra?: Record<string, unknown>
}

export type Skill = {
  /** Directory the skill was loaded from. */
  dir: string
  /** Parsed frontmatter. Always has `name`. */
  frontmatter: SkillFrontmatter
  /** Raw SKILL.md body (Markdown, after the frontmatter). */
  body: string
  /** Absolute path to the SKILL.md file. */
  filePath: string
}

const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/

/**
 * Parse a minimal YAML-like frontmatter block. We intentionally avoid a
 * full YAML parser — the supported shape is small (strings, simple lists
 * with `-` prefix, numbers). For anything richer, callers can pre-process
 * the raw text and call `parseSkill` with the result.
 */
export function parseFrontmatter(raw: string): { frontmatter: SkillFrontmatter; body: string } | null {
  const m = FRONTMATTER_RE.exec(raw)
  if (!m) return null
  const yamlBlock = m[1] ?? ""
  const body = (m[2] ?? "").trimStart()
  const fm: SkillFrontmatter = { name: "", extra: {} }
  const lines = yamlBlock.split(/\r?\n/)
  let currentListKey: string | null = null
  for (const line of lines) {
    if (!line.trim()) continue
    const listMatch = /^\s*-\s*(.+?)\s*$/.exec(line)
    if (listMatch && currentListKey) {
      const value = stripQuotes((listMatch[1] ?? "").trim())
      const arr = ((fm as unknown) as Record<string, unknown[]>)[currentListKey] as unknown[]
      arr.push(value)
      continue
    }
    const kvMatch = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line)
    if (!kvMatch) continue
    const key = normalizeKey(kvMatch[1] ?? "")
    let raw = (kvMatch[2] ?? "").trim()
    if (raw === "") {
      // Could be a list on the following lines.
      currentListKey = key
      ;((fm as unknown) as Record<string, unknown[]>)[key] = []
      continue
    }
    currentListKey = null
    if (raw.startsWith("[") && raw.endsWith("]")) {
      const items = raw
        .slice(1, -1)
        .split(",")
        .map((s) => stripQuotes(s.trim()))
        .filter((s) => s.length > 0)
      ;((fm as unknown) as Record<string, unknown[]>)[key] = items
      continue
    }
    const stripped = stripQuotes(raw)
    if (/^-?\d+(\.\d+)?$/.test(stripped)) {
      ;((fm as unknown) as Record<string, unknown>)[key] = Number(stripped)
    } else if (stripped === "true" || stripped === "false") {
      ;((fm as unknown) as Record<string, unknown>)[key] = stripped === "true"
    } else {
      ;((fm as unknown) as Record<string, unknown>)[key] = stripped
    }
  }
  if (!fm.name) return null
  return { frontmatter: fm, body }
}

function stripQuotes(s: string): string {
  if (s.length >= 2) {
    const first = s[0]
    const last = s[s.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return s.slice(1, -1)
    }
  }
  return s
}

/**
 * Map Claude Code / Codex hyphenated frontmatter keys to camelCase so
 * the parsed SkillFrontmatter has the shape callers expect. Unknown
 * keys pass through unchanged so callers can read them via `extra`.
 */
function normalizeKey(raw: string): string {
  const lower = raw.toLowerCase()
  if (lower === "allowed-tools") return "allowedTools"
  if (lower === "disable-model-invocation") return "disableModelInvocation"
  return raw
}

/**
 * Load and parse a single SKILL.md file. Throws on missing file or
 * missing/invalid frontmatter.
 */
export async function loadSkillFile(filePath: string): Promise<Skill> {
  const raw = await fs.readFile(filePath, "utf8")
  const parsed = parseFrontmatter(raw)
  if (!parsed) {
    throw new Error(`Invalid SKILL.md (no frontmatter) at ${filePath}`)
  }
  return {
    dir: path.dirname(filePath),
    filePath,
    frontmatter: parsed.frontmatter,
    body: parsed.body,
  }
}

/**
 * Load all SKILL.md files under `rootDir` (one level deep — each
 * immediate subdirectory is a skill). Missing directories are
 * silently ignored so this is safe to call on an empty tree.
 */
export async function loadSkillDir(rootDir: string): Promise<Skill[]> {
  let entries: string[] = []
  try {
    entries = await fs.readdir(rootDir)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return []
    throw err
  }
  const skills: Skill[] = []
  for (const name of entries) {
    const dir = path.join(rootDir, name)
    let stat
    try {
      stat = await fs.stat(dir)
    } catch {
      continue
    }
    if (!stat.isDirectory()) continue
    const file = path.join(dir, "SKILL.md")
    try {
      skills.push(await loadSkillFile(file))
    } catch {
      // Skip invalid skills silently; callers can opt into stricter
      // loading by calling `loadSkillFile` directly.
    }
  }
  return skills
}

/**
 * Find skills whose `triggers` match any of the given prefixes.
 * Useful for prompt routing: given the user's typed prefix, return
 * the candidate skills to inject into the prompt.
 */
export function matchSkillsByTrigger(skills: Skill[], prefix: string): Skill[] {
  const needle = prefix.toLowerCase()
  return skills.filter((s) =>
    s.frontmatter.triggers?.some((t) => needle.startsWith(t.toLowerCase())),
  )
}

/**
 * Model-driven skill matching — same as `matchSkillsByTrigger` but
 * filters out skills with `disable-model-invocation: true`. The agent
 * loop should call this when deciding whether to auto-inject a skill
 * based on heuristic triggers. Slash-command skills (`/think`, etc.)
 * stay reachable from the user's typed command but never get auto-
 * injected based on prompt content.
 */
export function matchSkillsForModel(skills: Skill[], prefix: string): Skill[] {
  return matchSkillsByTrigger(skills, prefix).filter(
    (s) => !s.frontmatter.disableModelInvocation,
  )
}

/**
 * Resolve the effective tool allowlist for a skill.
 * - When `allowedTools` is set, the runtime should restrict tool
 *   dispatch to those names while the skill is active.
 * - When unset, the runtime falls back to the default tool surface
 *   (no restriction from this skill).
 */
export function getSkillAllowedTools(skill: Skill): string[] | undefined {
  return skill.frontmatter.allowedTools
}

/**
 * Render a skill to a short description block for inclusion in a prompt.
 */
export function renderSkillSummary(skill: Skill): string {
  const desc = skill.frontmatter.description ?? ""
  return `- **${skill.frontmatter.name}**: ${desc}`
}