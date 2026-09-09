/**
 * NoveltyDetector — token-overlap redundancy detector (借鉴 Kosmos orchestration/novelty_detector.py).
 *
 * Kosmos's NoveltyDetector prevents redundant tasks across research cycles
 * by computing cosine similarity between task embeddings. Tasks above a
 * similarity threshold (default 0.75) are flagged as redundant.
 *
 * Maximilian adapts this without the sentence-transformers dependency.
 * It uses a Jaccard similarity over token n-grams (default: bigrams) plus
 * a bag-of-words fallback. This is less precise than semantic embeddings
 * but deterministic, dependency-free, and fast for typical task counts.
 *
 * For higher fidelity, callers can pass an `embedFn: (text) => number[]`
 * that returns precomputed embeddings and use `cosineSimilarity` directly.
 */

export interface NoveltyDetectorOptions {
  /** Similarity threshold (0-1). Tasks >= threshold are redundant. Default: 0.75. */
  threshold?: number
  /** N-gram size for token overlap (default: 2 = bigrams). */
  ngramSize?: number
  /** Optional external embedding function (overrides token overlap). */
  embedFn?: (text: string) => number[] | Promise<number[]>
}

export interface NoveltyCheck {
  isNovel: boolean
  /** Highest similarity found among indexed tasks. */
  maxSimilarity: number
  /** Indexed task descriptions that matched above threshold. */
  similarTasks: string[]
}

export interface PastTask {
  description: string
  type?: string
}

export class NoveltyDetector {
  private readonly threshold: number
  private readonly ngramSize: number
  private readonly embedFn?: (text: string) => number[] | Promise<number[]>
  private readonly pastTasks: PastTask[] = []
  private readonly pastEmbeddings: number[][] = []

  constructor(options?: NoveltyDetectorOptions) {
    this.threshold = options?.threshold ?? 0.75
    this.ngramSize = options?.ngramSize ?? 2
    this.embedFn = options?.embedFn
  }

  /** Index past tasks for future similarity checks. */
  index(tasks: ReadonlyArray<PastTask>): void {
    for (const task of tasks) {
      this.pastTasks.push(task)
      if (this.embedFn) {
        const embedding = this.embedFn(task.description)
        // If async, callers must pre-resolve; we capture sync values only.
        if (Array.isArray(embedding)) {
          this.pastEmbeddings.push(embedding)
        } else {
          // Skip embedding for async results — caller should pre-resolve.
          this.pastEmbeddings.push([])
        }
      }
    }
  }

  /** Index a single task with a precomputed embedding (async-friendly). */
  indexWithEmbedding(task: PastTask, embedding: number[]): void {
    this.pastTasks.push(task)
    this.pastEmbeddings.push(embedding)
  }

  /**
   * Check if `taskDescription` is novel against the indexed set. If an
   * `embedFn` is configured but no embedding is provided, falls back to
   * token-overlap similarity.
   */
  check(taskDescription: string, embedding?: number[]): NoveltyCheck {
    if (this.pastTasks.length === 0) {
      return { isNovel: true, maxSimilarity: 0, similarTasks: [] }
    }

    let maxSim = 0
    const similar: string[] = []
    for (let i = 0; i < this.pastTasks.length; i++) {
      let sim: number
      if (embedding && this.pastEmbeddings[i] && this.pastEmbeddings[i].length > 0) {
        sim = cosineSimilarity(embedding, this.pastEmbeddings[i])
      } else {
        const pastEmb = this.pastEmbeddings[i]
        sim = pastEmb && pastEmb.length > 0 && embedding
          ? cosineSimilarity(embedding, pastEmb)
          : jaccardSimilarity(tokenize(taskDescription), tokenize(this.pastTasks[i].description), this.ngramSize)
      }
      if (sim > maxSim) maxSim = sim
      if (sim >= this.threshold) similar.push(this.pastTasks[i].description)
    }

    return {
      isNovel: maxSim < this.threshold,
      maxSimilarity: maxSim,
      similarTasks: similar,
    }
  }

  /** Number of indexed tasks. */
  size(): number {
    return this.pastTasks.length
  }

  /** Drop all indexed tasks. */
  clear(): void {
    this.pastTasks.length = 0
    this.pastEmbeddings.length = 0
  }
}

// ─── Similarity primitives ───────────────────────────────────────────

/** Tokenize text into lowercase word tokens, dropping punctuation. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0)
}

/** Generate n-gram set from token array. */
export function ngrams(tokens: ReadonlyArray<string>, n: number): Set<string> {
  const out = new Set<string>()
  if (tokens.length < n || n < 1) {
    if (n === 1 && tokens.length > 0) for (const t of tokens) out.add(t)
    return out
  }
  for (let i = 0; i <= tokens.length - n; i++) {
    out.add(tokens.slice(i, i + n).join(" "))
  }
  return out
}

/** Jaccard similarity between two token arrays via n-grams. */
export function jaccardSimilarity(a: string[], b: string[], n = 2): number {
  if (a.length === 0 && b.length === 0) return 1
  const sa = ngrams(a, n)
  const sb = ngrams(b, n)
  if (sa.size === 0 && sb.size === 0) return 1
  let inter = 0
  for (const x of sa) if (sb.has(x)) inter++
  const union = sa.size + sb.size - inter
  return union === 0 ? 0 : inter / union
}

/** Cosine similarity between two numeric vectors. */
export function cosineSimilarity(a: ReadonlyArray<number>, b: ReadonlyArray<number>): number {
  if (a.length !== b.length || a.length === 0) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}