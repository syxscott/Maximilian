/**
 * EmbeddingRouter — enhances ModelRouter with similarity-based classification.
 *
 * Uses embedding similarity to match task descriptions against historical
 * task classifications. When a new task is similar (cosine > threshold) to
 * a previously-classified task, the historical classification is reused.
 * Otherwise, falls back to keyword heuristics + LLM classification.
 *
 * This solves the problem of keyword-based heuristics misclassifying
 * nuanced tasks (e.g. "design a system" vs "write a hello world").
 *
 * Architecture:
 *   1. embed(task.description) → vector
 *   2. cos similarity vs cached vectors
 *   3. If best match > threshold → use cached classification
 *   4. Else → use keyword heuristic + add to cache
 */

import {
  ModelRouter,
  deriveTaskCharacteristics,
  type TaskCharacteristics,
  type TaskType,
  type TaskComplexity,
} from "./model-router.js"
import type { AgentRole } from "./types.js"

export interface EmbeddingFn {
  (text: string): Promise<number[]>
}

export interface ClassificationEntry {
  taskDescription: string
  embedding: number[]
  characteristics: TaskCharacteristics
  classifiedAt: number
  /** Number of times this classification was reused. */
  hitCount: number
}

export interface EmbeddingRouterOptions {
  /** Cosine similarity threshold for cache hit (0-1). Default: 0.85. */
  similarityThreshold?: number
  /** Max cache entries (oldest pruned). Default: 1000. */
  maxCacheSize?: number
  /** Embedding function (typically OpenAI ada-002 or local model). */
  embed: EmbeddingFn
}

export class EmbeddingRouter {
  private modelRouter: ModelRouter
  private embed: EmbeddingFn
  private threshold: number
  private maxCacheSize: number
  private cache: ClassificationEntry[] = []
  private stats = { hits: 0, misses: 0, fallback: 0 }

  constructor(modelRouter: ModelRouter, options: EmbeddingRouterOptions) {
    this.modelRouter = modelRouter
    this.embed = options.embed
    this.threshold = options.similarityThreshold ?? 0.85
    this.maxCacheSize = options.maxCacheSize ?? 1000
  }

  /**
   * Classify a task and select the best model.
   * Tries embedding similarity first, falls back to heuristics.
   */
  async selectModel(task: { agentRole: AgentRole; description: string }): Promise<{
    provider: string
    model: string
    characteristics: TaskCharacteristics
    source: "cache" | "heuristic" | "fallback"
  }> {
    let characteristics: TaskCharacteristics
    let source: "cache" | "heuristic" | "fallback" = "heuristic"

    // Try embedding cache
    try {
      const embedding = await this.embed(task.description)
      const cached = this.findSimilar(embedding)
      if (cached) {
        characteristics = cached.characteristics
        cached.hitCount++
        this.stats.hits++
        source = "cache"
      } else {
        // Fall back to heuristic
        characteristics = deriveTaskCharacteristics(task)
        this.addToCache(task.description, embedding, characteristics)
        this.stats.misses++
      }
    } catch {
      // Embedding failed — fall back to heuristic
      characteristics = deriveTaskCharacteristics(task)
      this.stats.fallback++
      source = "fallback"
    }

    const selection = this.modelRouter.selectModel(characteristics)
    return { ...selection, characteristics, source }
  }

  /** Find the most similar cached entry. */
  private findSimilar(embedding: number[]): ClassificationEntry | null {
    if (this.cache.length === 0) return null

    let bestEntry: ClassificationEntry | null = null
    let bestScore = this.threshold

    for (const entry of this.cache) {
      const score = cosineSimilarity(embedding, entry.embedding)
      if (score >= bestScore) {
        bestScore = score
        bestEntry = entry
      }
    }

    return bestEntry
  }

  /** Add a new entry to the cache, pruning if over limit. */
  private addToCache(
    description: string,
    embedding: number[],
    characteristics: TaskCharacteristics,
  ): void {
    this.cache.push({
      taskDescription: description,
      embedding,
      characteristics,
      classifiedAt: Date.now(),
      hitCount: 0,
    })

    if (this.cache.length > this.maxCacheSize) {
      // Prune oldest entries (by classifiedAt)
      this.cache.sort((a, b) => a.classifiedAt - b.classifiedAt)
      this.cache.splice(0, this.cache.length - this.maxCacheSize)
    }
  }

  /**
   * Manually inject a classification (for bootstrapping from historical data).
   *
   * Callers MUST supply the embedding vector — without one the entry would
   * never match any cosine-similarity lookup (an empty vector returns 0 for
   * every query), so silently storing `embedding: []` would just bloat the
   * cache with entries that can never hit. Use `embed()` (the injected
   * embedder) to compute the vector first.
   */
  injectClassification(
    taskDescription: string,
    characteristics: TaskCharacteristics,
    embedding: number[],
  ): void {
    if (!Array.isArray(embedding) || embedding.length === 0) {
      throw new Error(
        "EmbeddingRouter.injectClassification requires a non-empty embedding vector; " +
          "compute one via embed() first — empty embeddings never match lookups.",
      )
    }
    this.cache.push({
      taskDescription,
      embedding,
      characteristics,
      classifiedAt: Date.now(),
      hitCount: 0,
    })
    if (this.cache.length > this.maxCacheSize) {
      this.cache.sort((a, b) => a.classifiedAt - b.classifiedAt)
      this.cache.splice(0, this.cache.length - this.maxCacheSize)
    }
  }

  /** Get cache statistics. */
  getStats(): {
    hits: number
    misses: number
    fallback: number
    cacheSize: number
    hitRate: number
  } {
    const total = this.stats.hits + this.stats.misses
    return {
      ...this.stats,
      cacheSize: this.cache.length,
      hitRate: total > 0 ? this.stats.hits / total : 0,
    }
  }

  /** Clear the cache (for testing). */
  clearCache(): void {
    this.cache = []
    this.stats = { hits: 0, misses: 0, fallback: 0 }
  }
}

/** Cosine similarity between two vectors. */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0) return 0
  if (a.length !== b.length) return 0

  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!
    normA += a[i]! * a[i]!
    normB += b[i]! * b[i]!
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}
