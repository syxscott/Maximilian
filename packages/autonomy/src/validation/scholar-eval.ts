/**
 * ScholarEval 8-Dimension Quality Framework (borrowed from Kosmos).
 *
 * Evaluates task/agent outputs across 8 quality dimensions inspired by academic peer review:
 *   rigor (0.25), impact (0.20), novelty (0.15), reproducibility (0.15),
 *   clarity (0.10), coherence (0.10), limitations (0.03), ethics (0.02).
 *
 * Approval gate: overall >= 0.75 AND rigor >= 0.70.
 *
 * Kosmos reference:
 *   https://raw.githubusercontent.com/jimmc414/Kosmos/master/kosmos/validation/scholar_eval.py
 */

export interface ScholarEvalScore {
  /** Methodological rigor: test coverage, correctness evidence, build/test/replay. Weight 0.25. */
  rigor: number;
  /** Importance: requirements completeness, user value. Weight 0.20. */
  impact: number;
  /** Solution delta vs existing approaches: non-redundancy. Weight 0.15. */
  novelty: number;
  /** Build/test/replay reproducibility. Weight 0.15. */
  reproducibility: number;
  /** Artifact/API/code clarity and readability. Weight 0.10. */
  clarity: number;
  /** Cross-agent contract consistency. Weight 0.10. */
  coherence: number;
  /** Known gaps and caveats acknowledged. Weight 0.03. */
  limitations: number;
  /** Security/privacy/license considerations. Weight 0.02. */
  ethics: number;
}

export interface ScholarEvalResult {
  scores: ScholarEvalScore;
  overall: number;
  passes: boolean;
  feedback: string;
}

const WEIGHTS: Record<keyof ScholarEvalScore, number> = {
  rigor: 0.25,
  impact: 0.20,
  novelty: 0.15,
  reproducibility: 0.15,
  clarity: 0.10,
  coherence: 0.10,
  limitations: 0.03,
  ethics: 0.02,
};

const MIN_RIGOR = 0.70;
const MIN_OVERALL = 0.75;

/**
 * Compute overall score from weighted dimensions.
 */
function computeOverall(scores: ScholarEvalScore): number {
  return (
    scores.rigor * WEIGHTS.rigor +
    scores.impact * WEIGHTS.impact +
    scores.novelty * WEIGHTS.novelty +
    scores.reproducibility * WEIGHTS.reproducibility +
    scores.clarity * WEIGHTS.clarity +
    scores.coherence * WEIGHTS.coherence +
    scores.limitations * WEIGHTS.limitations +
    scores.ethics * WEIGHTS.ethics
  );
}

/**
 * Generate actionable feedback for dimensions below threshold.
 */
function generateFeedback(scores: ScholarEvalScore): string {
  const issues: string[] = [];
  for (const [dim, weight] of Object.entries(WEIGHTS) as [keyof ScholarEvalScore, number][]) {
    if (scores[dim] < 0.6) {
      issues.push(`${dim} (${(weight * 100).toFixed(0)}% weight) is low (${(scores[dim] * 10).toFixed(1)}/10)`);
    }
  }
  if (issues.length === 0) return "All dimensions meet minimum threshold.";
  return `Weak dimensions: ${issues.join("; ")}.`;
}

/**
 * Evaluate an agent output with default heuristic scoring.
 * For production, replace with LLM judge or customScorers.
 */
export function scholarEval(
  output: {
    hasTests?: boolean;
    hasBuild?: boolean;
    buildPasses?: boolean;
    testPasses?: boolean;
    errorRate?: number;
    linesOfCode?: number;
    docsScore?: number;
    repeatsPrior?: boolean;
    securityFlags?: number;
    ethicalFlags?: number;
  },
  options?: {
    customScorers?: Partial<ScholarEvalScore>;
  },
): ScholarEvalResult {
  const s = options?.customScorers ?? {};

  // Heuristic scores (0-1 scale)
  const scores: ScholarEvalScore = {
    // Rigor: evidence of correctness (tests, build, CI)
    rigor: s.rigor ?? (
      (output.hasTests ? 0.8 : 0) +
      (output.buildPasses ? 0.2 : 0)
    ),
    // Impact: scope/completeness
    impact: s.impact ?? (
      0.5 + (output.linesOfCode ? Math.min(0.3, output.linesOfCode / 1000) : 0)
    ),
    // Novelty: non-redundant
    novelty: s.novelty ?? (output.repeatsPrior ? 0.3 : 0.7),
    // Reproducibility: build/test pass
    reproducibility: s.reproducibility ?? (
      (output.buildPasses && output.testPasses ? 1.0 :
       output.buildPasses ? 0.6 :
       output.hasBuild ? 0.3 : 0.1)
    ),
    // Clarity: documentation score
    clarity: s.clarity ?? (output.docsScore ?? 0.5),
    // Coherence: default to adequate
    coherence: s.coherence ?? 0.7,
    // Limitations: none acknowledged = 0.5
    limitations: s.limitations ?? 0.5,
    // Ethics: security/ethical flags
    ethics: s.ethics ?? Math.max(0, 1 - (output.securityFlags ?? 0) * 0.2 - (output.ethicalFlags ?? 0) * 0.3),
  };

  const overall = computeOverall(scores);
  const passes = overall >= MIN_OVERALL && scores.rigor >= MIN_RIGOR;
  const feedback = generateFeedback(scores);

  return { scores, overall, passes, feedback };
}
