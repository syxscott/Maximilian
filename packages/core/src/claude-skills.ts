// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Claude Code Skills Loader — loads SKILL.md files from ~/.claude/skills/.
 *
 * Claude Code stores skills at ~/.claude/skills/<skill-name>/SKILL.md with
 * YAML frontmatter. Maximilian's existing skills.ts already understands this
 * format — this module just provides the loader adapter that:
 *
 *   1. Resolves the Claude Code skills directory (default: ~/.claude/skills/)
 *   2. Loads all SKILL.md files
 *   3. Returns them in the shape AgentRuntime.getSkills expects
 *
 * @see packages/core/src/skills.ts for the underlying parser
 * @see https://agentskills.io/specification for the SKILL.md format
 */

import { promises as fs } from "node:fs"
import { existsSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { loadSkillDir, type Skill } from "./skills.js"

/**
 * Default location of Claude Code skills.
 * Resolved relative to the user's home directory.
 */
export const DEFAULT_CLAUDE_SKILLS_DIR = path.join(os.homedir(), ".claude", "skills")

/**
 * Options for the Claude Skills loader.
 */
export interface ClaudeSkillsLoaderOptions {
  /** Override the skills directory (defaults to ~/.claude/skills). */
  skillsDir?: string
  /** Custom OS home directory (mainly for testing). */
  homedir?: string
}

/**
 * Returns the absolute path to the Claude Code skills directory.
 *
 * Resolution order:
 *   1. options.skillsDir (explicit override)
 *   2. $CLAUDE_SKILLS_DIR env var
 *   3. ~/.claude/skills (default)
 */
export function resolveClaudeSkillsDir(options?: ClaudeSkillsLoaderOptions): string {
  if (options?.skillsDir) return options.skillsDir
  const envPath = process.env.CLAUDE_SKILLS_DIR
  if (envPath) return envPath
  const home = options?.homedir ?? os.homedir()
  return path.join(home, ".claude", "skills")
}

/**
 * Check whether the Claude Code skills directory exists and is readable.
 */
export function hasClaudeSkillsDir(options?: ClaudeSkillsLoaderOptions): boolean {
  const dir = resolveClaudeSkillsDir(options)
  return existsSync(dir)
}

/**
 * Load all Claude Code skills from the configured directory.
 *
 * Returns an empty array if the directory doesn't exist (silently —
 * Claude Code skills are optional).
 *
 * @example
 * const skills = await loadClaudeSkills()
 * for (const skill of skills) {
 *   console.log(skill.frontmatter.name, skill.frontmatter.description)
 * }
 */
export async function loadClaudeSkills(options?: ClaudeSkillsLoaderOptions): Promise<Skill[]> {
  const dir = resolveClaudeSkillsDir(options)
  if (!existsSync(dir)) return []
  return loadSkillDir(dir)
}

/**
 * Build a `getSkills` adapter for AgentRuntime that loads Claude Code skills.
 *
 * Returns a function suitable for `RuntimeOptions.getSkills` — the runtime
 * will call this per-task to fetch the current skill list and match against
 * task triggers.
 *
 * @example
 * const runtime = new AgentRuntime({
 *   getSkills: createClaudeSkillsProvider(),
 *   ...
 * })
 */
export function createClaudeSkillsProvider(
  options?: ClaudeSkillsLoaderOptions,
): () => Promise<Skill[]> {
  return async () => {
    return loadClaudeSkills(options)
  }
}

/**
 * Render Claude skills to a Markdown prelude block suitable for injection
 * into the agent's system prompt. Returns an empty string if no skills
 * were matched.
 */
export function renderClaudeSkillsPrelude(skills: Skill[]): string {
  if (skills.length === 0) return ""
  const summaries = skills.map((s) => renderSkillBlock(s)).join("\n\n")
  return `\n# Skills available\n\nThe following skills are available. Use the matching skill's name as guidance when the user's request matches its description.\n\n${summaries}\n`
}

function renderSkillBlock(skill: Skill): string {
  const { frontmatter, body } = skill
  const lines: string[] = []
  lines.push(`## ${frontmatter.name}`)
  if (frontmatter.description) {
    lines.push(frontmatter.description)
  }
  if (frontmatter.triggers && frontmatter.triggers.length > 0) {
    lines.push(`Triggers: ${frontmatter.triggers.join(", ")}`)
  }
  if (frontmatter.allowedTools && frontmatter.allowedTools.length > 0) {
    lines.push(`Allowed tools: ${frontmatter.allowedTools.join(", ")}`)
  }
  // Include the first ~500 chars of the body as a preview
  const preview = body.trim().split("\n").slice(0, 20).join("\n").slice(0, 500)
  if (preview) {
    lines.push("")
    lines.push("```")
    lines.push(preview)
    lines.push("```")
  }
  return lines.join("\n")
}

// Re-export for convenience
export { renderSkillSummary } from "./skills.js"
