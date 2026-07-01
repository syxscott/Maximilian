/**
 * Stage 1 — Capability Analyzer.
 *
 * Inputs a user request, outputs the list of capability IDs the team must cover.
 *
 * Strategy:
 *   1. Keyword match via CapabilityLibrary.detectByKeywords
 *   2. If LLM provided, ask the LLM to refine (optional, off by default)
 *   3. Always append "review"
 *   4. Expand dependencies of detected capabilities
 *   5. Dedup
 *
 * The output is intentionally a string[] (capability IDs), not Capability[].
 * The blueprint generator (Stage 2) is the one that materializes full objects.
 */

import { CapabilityLibrary } from "./capability-library.js";

export interface AnalyzerOptions {
  /** Force-include these capabilities regardless of detection. */
  alwaysInclude?: string[];
  /** Force-exclude (e.g. don't auto-add review). */
  neverInclude?: string[];
  /** When true, also expand transitive dependencies. */
  expandDependencies?: boolean;
}

export class CapabilityAnalyzer {
  constructor(
    private library: CapabilityLibrary = new CapabilityLibrary(),
    private options: AnalyzerOptions = {}
  ) {}

  analyze(userRequest: string): string[] {
    const opts = this.options;
    const detected = this.library.detectByKeywords(userRequest);
    const initial = new Set<string>(detected);

    if (opts.alwaysInclude) {
      for (const id of opts.alwaysInclude) initial.add(id);
    }
    if (opts.neverInclude) {
      for (const id of opts.neverInclude) initial.delete(id);
    } else {
      // Default: always include review.
      initial.add("review");
    }

    if (opts.expandDependencies !== false) {
      // Expand transitive capability dependencies.
      const queue = Array.from(initial);
      const seen = new Set<string>(initial);
      while (queue.length > 0) {
        const id = queue.shift()!;
        const cap = this.library.get(id);
        if (!cap) continue;
        for (const dep of cap.dependsOn) {
          if (!seen.has(dep)) {
            seen.add(dep);
            queue.push(dep);
          }
        }
      }
      return Array.from(seen);
    }

    return Array.from(initial);
  }
}
