import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { promises as fs } from "node:fs"
import path from "node:path"
import os from "node:os"
import {
  loadSkillDir,
  loadSkillFile,
  matchSkillsByTrigger,
  matchSkillsForModel,
  getSkillAllowedTools,
  parseFrontmatter,
  renderSkillSummary,
} from "../src/skills.js"

describe("parseFrontmatter", () => {
  it("parses a minimal frontmatter with name + description", () => {
    const raw = `---
name: web-search
description: Search the web for up-to-date information.
---

# Body`
    const parsed = parseFrontmatter(raw)!
    expect(parsed.frontmatter.name).toBe("web-search")
    expect(parsed.frontmatter.description).toBe("Search the web for up-to-date information.")
    expect(parsed.body.trim()).toBe("# Body")
  })

  it("parses a list of triggers", () => {
    const raw = `---
name: t
triggers:
  - search:
  - find:
---
body`
    const parsed = parseFrontmatter(raw)!
    expect(parsed.frontmatter.triggers).toEqual(["search:", "find:"])
  })

  it("parses inline list form", () => {
    const raw = `---
name: t
triggers: ["a", "b"]
---`
    const parsed = parseFrontmatter(raw)!
    expect(parsed.frontmatter.triggers).toEqual(["a", "b"])
  })

  it("parses numbers and booleans", () => {
    const raw = `---
name: t
version: 2
enabled: true
---`
    const parsed = parseFrontmatter(raw)!
    expect(parsed.frontmatter.version).toBe(2)
    expect((parsed.frontmatter as Record<string, unknown>).enabled).toBe(true)
  })

  it("returns null when frontmatter is missing", () => {
    expect(parseFrontmatter("# no frontmatter here")).toBeNull()
  })

  it("returns null when name is missing", () => {
    const raw = `---
description: missing name
---`
    expect(parseFrontmatter(raw)).toBeNull()
  })
})

describe("loadSkillDir", () => {
  let tmp: string
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "max-skills-"))
  })
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true })
  })

  it("returns empty array for missing dir", async () => {
    const out = await loadSkillDir(path.join(tmp, "missing"))
    expect(out).toEqual([])
  })

  it("loads every skill subdirectory", async () => {
    await fs.mkdir(path.join(tmp, "web-search"), { recursive: true })
    await fs.writeFile(
      path.join(tmp, "web-search", "SKILL.md"),
      `---
name: web-search
description: Search the web.
---

Body content`,
      "utf8",
    )
    await fs.mkdir(path.join(tmp, "summarize"), { recursive: true })
    await fs.writeFile(
      path.join(tmp, "summarize", "SKILL.md"),
      `---
name: summarize
description: Summarize long text.
---`,
      "utf8",
    )
    const skills = await loadSkillDir(tmp)
    expect(skills.map((s) => s.frontmatter.name).sort()).toEqual(["summarize", "web-search"])
  })

  it("skips directories without a valid SKILL.md", async () => {
    await fs.mkdir(path.join(tmp, "broken"), { recursive: true })
    await fs.writeFile(path.join(tmp, "broken", "SKILL.md"), "no frontmatter", "utf8")
    await fs.mkdir(path.join(tmp, "good"), { recursive: true })
    await fs.writeFile(
      path.join(tmp, "good", "SKILL.md"),
      "---\nname: g\ndescription: ok\n---\n",
      "utf8",
    )
    const skills = await loadSkillDir(tmp)
    expect(skills.map((s) => s.frontmatter.name)).toEqual(["g"])
  })
})

describe("loadSkillFile + matchSkillsByTrigger", () => {
  it("matches skills whose trigger prefixes the user input", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "max-skill-"))
    try {
      await fs.mkdir(path.join(tmp, "ws"), { recursive: true })
      const file = path.join(tmp, "ws", "SKILL.md")
      await fs.writeFile(
        file,
        `---
name: web-search
description: Search.
triggers: ["search:", "find:"]
---`,
        "utf8",
      )
      const skill = await loadSkillFile(file)
      expect(matchSkillsByTrigger([skill], "search: cats").map((s) => s.frontmatter.name)).toEqual(["web-search"])
      expect(matchSkillsByTrigger([skill], "Search: cats").map((s) => s.frontmatter.name)).toEqual(["web-search"])
      expect(matchSkillsByTrigger([skill], "hello")).toEqual([])
    } finally {
      await fs.rm(tmp, { recursive: true, force: true })
    }
  })
})

describe("renderSkillSummary", () => {
  it("renders a short markdown summary line", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "max-sum-"))
    try {
      const file = path.join(tmp, "SKILL.md")
      await fs.writeFile(
        file,
        "---\nname: foo\ndescription: a useful skill\n---\n",
        "utf8",
      )
      const skill = await loadSkillFile(file)
      expect(renderSkillSummary(skill)).toBe("- **foo**: a useful skill")
    } finally {
      await fs.rm(tmp, { recursive: true, force: true })
    }
  })
})

describe("Claude/Codex skill frontmatter compat", () => {
  it("normalizes allowed-tools to allowedTools", () => {
    const raw = `---
name: bash-only
allowed-tools: [Bash, Read]
description: a tool-restricted skill
---`
    const parsed = parseFrontmatter(raw)!
    expect(parsed.frontmatter.allowedTools).toEqual(["Bash", "Read"])
  })

  it("normalizes disable-model-invocation to disableModelInvocation", () => {
    const raw = `---
name: think
disable-model-invocation: true
triggers: ["/think"]
---`
    const parsed = parseFrontmatter(raw)!
    expect(parsed.frontmatter.disableModelInvocation).toBe(true)
  })

  it("parses allowed-tools as a YAML list, not just inline", () => {
    const raw = `---
name: web-search
allowed-tools:
  - WebSearch
  - WebFetch
---`
    const parsed = parseFrontmatter(raw)!
    expect(parsed.frontmatter.allowedTools).toEqual(["WebSearch", "WebFetch"])
  })

  it("getSkillAllowedTools returns the parsed list verbatim", () => {
    const raw = `---
name: t
allowed-tools: ["Bash"]
---`
    const skill = {
      dir: "/tmp/t",
      filePath: "/tmp/t/SKILL.md",
      frontmatter: parseFrontmatter(raw)!.frontmatter,
      body: "",
    }
    expect(getSkillAllowedTools(skill)).toEqual(["Bash"])
  })

  it("getSkillAllowedTools returns undefined when not set", () => {
    const raw = `---
name: t
---`
    const skill = {
      dir: "/tmp/t",
      filePath: "/tmp/t/SKILL.md",
      frontmatter: parseFrontmatter(raw)!.frontmatter,
      body: "",
    }
    expect(getSkillAllowedTools(skill)).toBeUndefined()
  })
})

describe("matchSkillsForModel — model-driven matching", () => {
  const tmp = path.join(os.tmpdir(), "max-skill-fixture")

  beforeEach(async () => {
    await fs.mkdir(tmp, { recursive: true })
  })

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true })
  })

  async function writeSkill(name: string, body: string): Promise<void> {
    const dir = path.join(tmp, name)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, "SKILL.md"), body, "utf8")
  }

  it("matchSkillsByTrigger returns every triggered skill (raw)", async () => {
    await writeSkill("search", `---
name: search
triggers: ["search:"]
disable-model-invocation: true
---`)
    await writeSkill("plain", `---
name: plain
triggers: ["plain:"]
---`)
    const skills = await loadSkillDir(tmp)
    const matches = matchSkillsByTrigger(skills, "plain: hi").map((s) => s.frontmatter.name)
    expect(matches).toEqual(["plain"])
  })

  it("matchSkillsForModel filters out skills with disableModelInvocation", async () => {
    await writeSkill("slash", `---
name: slash
triggers: ["/think"]
disable-model-invocation: true
---`)
    await writeSkill("auto", `---
name: auto
triggers: ["/think"]
---`)
    const skills = await loadSkillDir(tmp)
    const raw = matchSkillsByTrigger(skills, "/think deeply").map((s) => s.frontmatter.name).sort()
    expect(raw).toEqual(["auto", "slash"])
    const filtered = matchSkillsForModel(skills, "/think deeply").map((s) => s.frontmatter.name)
    expect(filtered).toEqual(["auto"])
  })

  it("matchSkillsForModel returns [] when only disabled skills match", async () => {
    await writeSkill("user-only", `---
name: user-only
triggers: ["/commit"]
disable-model-invocation: true
---`)
    const skills = await loadSkillDir(tmp)
    expect(matchSkillsForModel(skills, "/commit -m 'x'")).toEqual([])
    // raw matcher still finds it (slash-command path uses the unfiltered version)
    expect(matchSkillsByTrigger(skills, "/commit -m 'x'").map((s) => s.frontmatter.name)).toEqual(["user-only"])
  })
})