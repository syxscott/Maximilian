/**
 * FailureDetector — claim/evidence mismatch detection (借鉴 Kosmos failure_detector.py).
 *
 * Kosmos detects 3 failure modes via keyword/semantic analysis:
 *   - over-interpretation: strong claims without statistical support
 *   - invented metrics: undefined metrics referenced in findings
 *   - rabbit hole: drift from research question
 *
 * Maximilian adapts this to detect LLM output pathologies BEFORE they're
 * committed as Result outputs. The detector is purely heuristic
 * (keyword-based) — for LLM-judge fidelity, callers can pass customDetectors.
 */

export type FailureMode = "over_interpretation" | "invented_metrics" | "rabbit_hole"

export interface FailureSignal {
  mode: FailureMode
  confidence: number
  /** Snippet(s) that triggered the signal. */
  evidence: string[]
}

export interface FailureDetectionResult {
  signals: FailureSignal[]
  /** Aggregate score: 0 = no failure detected, 1 = severe failure. */
  overallScore: number
  /** True if overallScore >= 0.5 (configurable). */
  failed: boolean
}

// Keywords borrowed from Kosmos failure_detector.py.
const STRONG_CLAIM_WORDS = [
  "always", "never", "definitively", "proves", "proves that", "guarantees",
  "certain", "certainly", "absolutely", "without doubt", "undeniably",
  "all", "every", "none", "must",
]

const HEDGED_CLAIM_WORDS = [
  "may", "might", "could", "suggests", "appears", "seems", "possibly",
  "likely", "probably", "tends to", "in some cases", "often",
]

const STATISTICAL_SUPPORT_WORDS = [
  "p <", "p<", "p =", "p=", "ci", "confidence interval",
  "n =", "n=", "sample size", "effect size", "std", "standard deviation",
  "ANOVA", "t-test", "chi-square", "regression", "p-value",
]

const STANDARD_METRIC_PATTERNS = [
  /accuracy\s*[=:]/i,
  /precision\s*[=:]/i,
  /recall\s*[=:]/i,
  /f1[\s_-]*score\s*[=:]/i,
  /auc\s*[=:]/i,
  /rmse\s*[=:]/i,
  /mse\s*[=:]/i,
  /bleu\s*[=:]/i,
  /rouge\s*[=:]/i,
  /perplexity\s*[=:]/i,
  /\b\d+(\.\d+)?%/,
  /\b\d+(\.\d+)?\s*ms\b/,
  /\b\d+(\.\d+)?\s*seconds?\b/,
]

export interface FailureDetectorOptions {
  /** Score threshold for `failed` flag (default: 0.5). */
  threshold?: number
  /** Override a specific mode's detector (returns confidence 0-1). */
  customDetectors?: Partial<Record<FailureMode, (text: string) => FailureSignal | null>>
}

export function detectFailures(text: string, options?: FailureDetectorOptions): FailureDetectionResult {
  const threshold = options?.threshold ?? 0.5
  const detector: Record<FailureMode, (t: string) => FailureSignal | null> = {
    over_interpretation: options?.customDetectors?.over_interpretation ?? detectOverInterpretation,
    invented_metrics: options?.customDetectors?.invented_metrics ?? detectInventedMetrics,
    rabbit_hole: options?.customDetectors?.rabbit_hole ?? detectRabbitHole,
  }
  const signals: FailureSignal[] = []
  for (const mode of Object.keys(detector) as FailureMode[]) {
    const sig = detector[mode](text)
    if (sig && sig.confidence > 0) signals.push(sig)
  }
  // Aggregate: max of all signal confidences.
  const overallScore = signals.reduce((acc, s) => Math.max(acc, s.confidence), 0)
  return {
    signals,
    overallScore,
    failed: overallScore >= threshold,
  }
}

function detectOverInterpretation(text: string): FailureSignal | null {
  if (!text) return null
  const lower = text.toLowerCase()
  let strong = 0
  for (const w of STRONG_CLAIM_WORDS) if (lower.includes(w)) strong++
  let hedged = 0
  for (const w of HEDGED_CLAIM_WORDS) if (lower.includes(w)) hedged++
  let statsSupport = 0
  for (const w of STATISTICAL_SUPPORT_WORDS) if (lower.includes(w)) statsSupport++
  // Strong claims without statistical support = over-interpretation.
  if (strong === 0) return null
  const ratio = strong / Math.max(strong + hedged, 1)
  const supportFactor = statsSupport > 0 ? 0.5 : 1.0
  const confidence = clamp01(ratio * supportFactor)
  if (confidence < 0.2) return null
  const evidence: string[] = []
  for (const w of STRONG_CLAIM_WORDS) {
    if (lower.includes(w)) {
      evidence.push(`strong claim: "${w}"`)
      if (evidence.length >= 3) break
    }
  }
  return { mode: "over_interpretation", confidence, evidence }
}

function detectInventedMetrics(text: string): FailureSignal | null {
  if (!text) return null
  // Look for "metric: number" or "metric = number" patterns that aren't standard.
  const matches = text.match(/(\b[a-z][\w\- ]*?)\s*[=:]\s*(\d+(\.\d+)?)\b/gi) ?? []
  if (matches.length === 0) return null
  let unrecognised = 0
  const evidence: string[] = []
  for (const m of matches.slice(0, 10)) {
    const isStandard = STANDARD_METRIC_PATTERNS.some((p) => p.test(m))
    if (!isStandard) {
      unrecognised++
      if (evidence.length < 3) evidence.push(`non-standard metric: "${m.trim()}"`)
    }
  }
  if (unrecognised === 0) return null
  const confidence = clamp01(unrecognised / matches.length)
  return { mode: "invented_metrics", confidence, evidence }
}

function detectRabbitHole(text: string): FailureSignal | null {
  if (!text) return null
  const lower = text.toLowerCase()
  // Signals of drift: many hedges + tangents + many new topics without synthesis.
  const tangentWords = ["anyway", "by the way", "moving on", "off-topic", "incidentally", "side note"]
  let tangentHits = 0
  for (const w of tangentWords) if (lower.includes(w)) tangentHits++
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0)
  const longSentences = sentences.filter((s) => s.split(/\s+/).length > 60).length
  const longRatio = sentences.length > 0 ? longSentences / sentences.length : 0
  const confidence = clamp01(tangentHits * 0.3 + longRatio * 0.7)
  if (confidence < 0.2) return null
  return {
    mode: "rabbit_hole",
    confidence,
    evidence: tangentHits > 0 ? [`tangent markers: ${tangentHits}`] : [`long sentences: ${longSentences}`],
  }
}

function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0
  if (x < 0) return 0
  if (x > 1) return 1
  return x
}