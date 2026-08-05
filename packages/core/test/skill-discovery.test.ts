import { describe, it, expect, vi, afterEach } from "vitest"
import {
  pullSkillIndex,
  downloadFile,
  discoverSkills,
  CACHE_TTL_MS,
} from "../src/skill-discovery.js"

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("SkillDiscovery (借鉴 opencode)", () => {
  it("CACHE_TTL_MS is 7 days", () => {
    expect(CACHE_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000)
  })

  it("pullSkillIndex returns [] on non-200 index", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }))
    const dirs = await pullSkillIndex("https://example.com/skills", {
      cacheDir: "/tmp/__max_test_skills_a",
    })
    expect(dirs).toEqual([])
  })

  it("pullSkillIndex skips entries without SKILL.md", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ skills: [{ name: "bad", files: ["other.md"] }] }),
      })
      .mockResolvedValue({ ok: true, text: async () => "ok" })
    vi.stubGlobal("fetch", fetchMock)
    const dirs = await pullSkillIndex("https://x.com/", {
      cacheDir: "/tmp/__max_test_skills_b",
    })
    expect(dirs).toEqual([])
  })

  it("pullSkillIndex returns successfully downloaded skill names", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          skills: [{ name: "good", files: ["SKILL.md", "extra.txt"] }],
        }),
      })
      .mockResolvedValue({ ok: true, text: async () => "content" })
    vi.stubGlobal("fetch", fetchMock)
    const dirs = await pullSkillIndex("https://x.com/", {
      cacheDir: "/tmp/__max_test_skills_c",
    })
    expect(dirs).toEqual(["good"])
    // index.json + 2 files
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it("pullSkillIndex returns [] on fetch throw", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")))
    const dirs = await pullSkillIndex("https://x.com/", {
      cacheDir: "/tmp/__max_test_skills_d",
    })
    expect(dirs).toEqual([])
  })

  it("downloadFile returns false on non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }))
    expect(await downloadFile("https://x.com/f", "/tmp/__max_dl_false.md")).toBe(false)
  })

  it("downloadFile returns true on ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, text: async () => "hello" }),
    )
    expect(await downloadFile("https://x.com/f", "/tmp/__max_dl_ok.md")).toBe(true)
  })

  it("discoverSkills combines local + remote (deduped)", async () => {
    const { existsSync } = await import("node:fs")
    const localDir = "/tmp/__max_local_dir"
    if (!existsSync(localDir)) {
      const { mkdirSync, writeFileSync } = await import("node:fs")
      mkdirSync(localDir, { recursive: true })
      writeFileSync(`${localDir}/local-only`, "")
    }
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            skills: [{ name: "local-only", files: ["SKILL.md"] }],
          }),
        })
        .mockResolvedValue({ ok: true, text: async () => "x" }),
    )
    const all = await discoverSkills({
      localDir,
      remoteUrl: "https://r.com/",
      cacheDir: "/tmp/__max_remote_cache",
    })
    // 期望 local-only 出现一次(去重),不会因为 remote 也返回它而重复
    expect(all.filter((n) => n === "local-only")).toHaveLength(1)
  })
})