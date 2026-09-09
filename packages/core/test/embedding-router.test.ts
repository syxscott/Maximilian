import { describe, it, expect, vi } from "vitest"
import { ModelRouter, createDefaultModelRouter } from "../src/model-router.js"
import { EmbeddingRouter } from "../src/embedding-router.js"

// Mock embedding function that returns deterministic vectors based on text content
const mockEmbed = async (text: string): Promise<number[]> => {
  // Simple bag-of-words style embedding for testing
  const words = text.toLowerCase().split(/\s+/)
  const vocab = [
    "build",
    "code",
    "ui",
    "app",
    "design",
    "system",
    "fix",
    "bug",
    "simple",
    "complex",
    "write",
    "refactor",
  ]
  return vocab.map((w) => (words.some((word) => word.includes(w)) ? 1 : 0))
}

describe("EmbeddingRouter", () => {
  it("uses heuristic on first call (cache miss)", async () => {
    const router = new EmbeddingRouter(createDefaultModelRouter(), { embed: mockEmbed })
    const result = await router.selectModel({ agentRole: "frontend", description: "build a UI" })
    expect(result.source).toBe("heuristic")
    expect(result.characteristics).toBeDefined()
    expect(result.provider).toBeDefined()
    expect(result.model).toBeDefined()
  })

  it("reuses classification on similar description (cache hit)", async () => {
    const router = new EmbeddingRouter(createDefaultModelRouter(), {
      embed: mockEmbed,
      similarityThreshold: 0.5,
    })

    // First call — cache miss
    const first = await router.selectModel({ agentRole: "frontend", description: "build a UI app" })
    expect(first.source).toBe("heuristic")

    // Second call with similar description — should hit cache
    const second = await router.selectModel({
      agentRole: "frontend",
      description: "build a complex UI app",
    })
    expect(second.source).toBe("cache")
    expect(second.characteristics).toEqual(first.characteristics)
  })

  it("tracks hit/miss stats", async () => {
    const router = new EmbeddingRouter(createDefaultModelRouter(), {
      embed: mockEmbed,
      similarityThreshold: 0.5,
    })
    await router.selectModel({ agentRole: "frontend", description: "build a UI" })
    await router.selectModel({ agentRole: "frontend", description: "build a UI" }) // hit
    await router.selectModel({ agentRole: "backend", description: "different completely unique" }) // miss

    const stats = router.getStats()
    expect(stats.hits).toBeGreaterThanOrEqual(1)
    expect(stats.misses).toBeGreaterThanOrEqual(1)
    expect(stats.cacheSize).toBeGreaterThan(0)
  })

  it("falls back to heuristic on embedding error", async () => {
    const failingEmbed = vi.fn().mockRejectedValue(new Error("API down"))
    const router = new EmbeddingRouter(createDefaultModelRouter(), { embed: failingEmbed })

    const result = await router.selectModel({ agentRole: "general", description: "test" })
    expect(result.source).toBe("fallback")
    expect(result.provider).toBeDefined()
  })

  it("prunes cache when max size exceeded", async () => {
    const router = new EmbeddingRouter(createDefaultModelRouter(), {
      embed: mockEmbed,
      maxCacheSize: 3,
    })

    // Add 5 entries
    for (let i = 0; i < 5; i++) {
      await router.selectModel({ agentRole: "general", description: `task ${i} unique` })
    }

    const stats = router.getStats()
    expect(stats.cacheSize).toBeLessThanOrEqual(3)
  })

  it("injectClassification adds to cache with valid embedding", async () => {
    const router = new EmbeddingRouter(createDefaultModelRouter(), { embed: mockEmbed })
    const embedding = await mockEmbed("manual entry")
    router.injectClassification(
      "manual entry",
      {
        complexity: "complex",
        type: "code",
        agentRole: "backend",
      },
      embedding,
    )
    const stats = router.getStats()
    expect(stats.cacheSize).toBe(1)
  })

  it("injectClassification rejects empty embeddings", () => {
    const router = new EmbeddingRouter(createDefaultModelRouter(), { embed: mockEmbed })
    expect(() =>
      router.injectClassification(
        "manual entry",
        {
          complexity: "complex",
          type: "code",
          agentRole: "backend",
        },
        [],
      ),
    ).toThrow(/requires a non-empty embedding vector/)
  })

  it("clearCache resets state", async () => {
    const router = new EmbeddingRouter(createDefaultModelRouter(), { embed: mockEmbed })
    await router.selectModel({ agentRole: "general", description: "test" })
    expect(router.getStats().cacheSize).toBeGreaterThan(0)
    router.clearCache()
    expect(router.getStats().cacheSize).toBe(0)
  })
})
