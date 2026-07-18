// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Tests for claude-skills.ts — Claude Code skills loader.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { promises as fs } from "node:fs"
import path from "node:path"
import os from "node:os"
import {
  loadClaudeSkills,
  resolveClaudeSkillsDir,
  hasClaudeSkillsDir,
  createClaudeSkillsProvider,
  renderClaudeSkillsPrelude,
  DEFAULT_CLAUDE_SKILLS_DIR,
} from "../src/claude-skills.js"

let testDir: string

beforeEach(async () => {
  testDir = await fs.mkdtemp(path.join(os.tmpdir(), "max-skills-"))
})

afterEach(async () => {
  await fs.rm(testDir, { recursive: true, force: true })
})

async function writeSkill(
  name: string,
  frontmatter: string,
  body = "# Body\n\nInstructions here.",
): Promise<void> {
  const skillDir = path.join(testDir, name)
  await fs.mkdir(skillDir, { recursive: true })
  await fs.writeFile(
    path.join(skillDir, "SKILL.md"),
    `---\n${frontmatter}\n---\n\n${body}`,
    "utf8",
  )
}

describe("resolveClaudeSkillsDir", () => {
  it("returns explicit override when provided", () => {
    const custom = "/custom/path"
    expect(resolveClaudeSkillsDir({ skillsDir: custom })).toBe(custom)
  })

  it("returns ~/.claude/skills by default", () => {
    expect(DEFAULT_CLAUDE_SKILLS_DIR).toBe(path.join(os.homedir(), ".claude", "skills"))
  })

  it("honours custom homedir", () => {
    const result = resolveClaudeSkillsDir({ homedir: "/fake/home" })
    expect(result).toBe(path.join("/fake/home", ".claude", "skills"))
  })
})

describe("hasClaudeSkillsDir", () => {
  it("returns false for non-existent dir", () => {
    expect(hasClaudeSkillsDir({ skillsDir: "/nonexistent/path" })).toBe(false)
  })

  it("returns true for existing dir", async () => {
    expect(hasClaudeSkillsDir({ skillsDir: testDir })).toBe(true)
  })
})

describe("loadClaudeSkills", () => {
  it("returns empty array when dir doesn't exist", async () => {
    const skills = await loadClaudeSkills({ skillsDir: "/nonexistent" })
    expect(skills).toEqual([])
  })

  it("returns empty array when dir is empty", async () => {
    const skills = await loadClaudeSkills({ skillsDir: testDir })
    expect(skills).toEqual([])
  })

  it("loads a single skill correctly", async () => {
    await writeSkill(
      "web-search",
      "name: web-search\ndescription: Search the web.",
    )

    const skills = await loadClaudeSkills({ skillsDir: testDir })
    expect(skills).toHaveLength(1)
    expect(skills[0].frontmatter.name).toBe("web-search")
    expect(skills[0].frontmatter.description).toBe("Search the web.")
    expect(skills[0].body).toContain("Body")
    expect(skills[0].body).toContain("Instructions here.")
  })

  it("loads multiple skills", async () => {
    await writeSkill("skill-a", "name: skill-a\ndescription: First.")
    await writeSkill("skill-b", "name: skill-b\ndescription: Second.")
    await writeSkill("skill-c", "name: skill-c\ndescription: Third.")

    const skills = await loadClaudeSkills({ skillsDir: testDir })
    expect(skills).toHaveLength(3)
    const names = skills.map((s) => s.frontmatter.name).sort()
    expect(names).toEqual(["skill-a", "skill-b", "skill-c"])
  })

  it("parses triggers from frontmatter", async () => {
    await writeSkill(
      "triggered",
      'name: triggered\ndescription: Has triggers.\ntriggers:\n  - "search:"\n  - "find:"',
    )

    const skills = await loadClaudeSkills({ skillsDir: testDir })
    expect(skills[0].frontmatter.triggers).toEqual(["search:", "find:"])
  })

  it("parses allowedTools from frontmatter", async () => {
    await writeSkill(
      "tool-bound",
      'name: tool-bound\ndescription: Has allowed tools.\nallowed-tools:\n  - "Read"\n  - "Write"',
    )

    const skills = await loadClaudeSkills({ skillsDir: testDir })
    expect(skills[0].frontmatter.allowedTools).toEqual(["Read", "Write"])
  })

  it("skips invalid skills silently", async () => {
    // Skill with no frontmatter
    const badDir = path.join(testDir, "bad-skill")
    await fs.mkdir(badDir, { recursive: true })
    await fs.writeFile(path.join(badDir, "SKILL.md"), "no frontmatter here")

    // Valid skill
    await writeSkill("good", "name: good\ndescription: Good skill.")

    const skills = await loadClaudeSkills({ skillsDir: testDir })
    expect(skills).toHaveLength(1)
    expect(skills[0].frontmatter.name).toBe("good")
  })
})

describe("createClaudeSkillsProvider", () => {
  it("returns a function that loads skills", async () => {
    await writeSkill("alpha", "name: alpha\ndescription: Alpha skill.")
    await writeSkill("beta", "name: beta\ndescription: Beta skill.")

    const provider = createClaudeSkillsProvider({ skillsDir: testDir })
    const skills = await provider()
    expect(skills).toHaveLength(2)
  })

  it("returns empty array when dir missing", async () => {
    const provider = createClaudeSkillsProvider({ skillsDir: "/nonexistent" })
    const skills = await provider()
    expect(skills).toEqual([])
  })
})

describe("renderClaudeSkillsPrelude", () => {
  it("returns empty string when no skills", () => {
    expect(renderClaudeSkillsPrelude([])).toBe("")
  })

  it("renders skill block with description", async () => {
    await writeSkill("test", "name: test\ndescription: A test skill.")

    const skills = await loadClaudeSkills({ skillsDir: testDir })
    const prelude = renderClaudeSkillsPrelude(skills)

    expect(prelude).toContain("# Skills available")
    expect(prelude).toContain("## test")
    expect(prelude).toContain("A test skill.")
  })

  it("renders triggers when present", async () => {
    await writeSkill(
      "trig",
      'name: trig\ndescription: With triggers.\ntriggers:\n  - "do:"',
    )

    const skills = await loadClaudeSkills({ skillsDir: testDir })
    const prelude = renderClaudeSkillsPrelude(skills)

    expect(prelude).toContain("Triggers: do:")
  })

  it("renders allowed tools when present", async () => {
    await writeSkill(
      "tooled",
      'name: tooled\ndescription: With tools.\nallowed-tools:\n  - "Bash(*)"',
    )

    const skills = await loadClaudeSkills({ skillsDir: testDir })
    const prelude = renderClaudeSkillsPrelude(skills)

    expect(prelude).toContain("Allowed tools: Bash(*)")
  })

  it("includes body preview", async () => {
    await writeSkill(
      "with-body",
      "name: with-body\ndescription: Has body.",
      "# Instructions\n\nStep 1: do the thing.\nStep 2: do the next thing.",
    )

    const skills = await loadClaudeSkills({ skillsDir: testDir })
    const prelude = renderClaudeSkillsPrelude(skills)

    expect(prelude).toContain("Instructions")
    expect(prelude).toContain("Step 1")
  })
})
