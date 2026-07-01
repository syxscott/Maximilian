/**
 * Phase 9 — Frontend Benchmark Runner.
 *
 * Validates agent-generated component code using regex-based structural
 * analysis. Checks for: React hooks, JSX/HTML structure, semantic elements,
 * accessibility attributes, event handlers, state management patterns.
 * No external AST parser dependencies — pure regex matching.
 */

import type { FrontendTaskContext } from "../types.js";

export interface FrontendValidationResult {
  passed: boolean;
  quality: number;
  structuralFindings: StructuralFinding[];
  syntaxValid: boolean;
  error?: string;
}

export interface StructuralFinding {
  label: string;
  required: boolean;
  found: boolean;
  pattern: string;
}

export class FrontendRunner {
  /**
   * Validate component code against structural requirements.
   */
  validateComponent(code: string, context: FrontendTaskContext): FrontendValidationResult {
    try {
      // 1. Basic syntax check.
      const syntaxValid = this.checkSyntax(code, context.componentType);

      if (!syntaxValid) {
        return {
          passed: false,
          quality: 0,
          structuralFindings: [],
          syntaxValid: false,
          error: "Component code has syntax errors",
        };
      }

      // 2. Run structural queries.
      const findings: StructuralFinding[] = [];
      for (const query of context.structuralQueries) {
        const regex = new RegExp(query.pattern, "ms");
        const found = regex.test(code);
        findings.push({
          label: query.label,
          required: query.required,
          found,
          pattern: query.pattern,
        });
      }

      // 3. Run built-in quality checks.
      const builtInChecks = this.runBuiltInChecks(code, context.componentType);
      findings.push(...builtInChecks);

      // 4. Compute quality score.
      const requiredFindings = findings.filter((f) => f.required);
      const passedRequired = requiredFindings.filter((f) => f.found).length;
      const optionalFindings = findings.filter((f) => !f.required);
      const passedOptional = optionalFindings.filter((f) => f.found).length;

      const requiredWeight = 0.7;
      const optionalWeight = 0.3;

      const requiredScore = requiredFindings.length > 0
        ? (passedRequired / requiredFindings.length) * requiredWeight
        : requiredWeight;
      const optionalScore = optionalFindings.length > 0
        ? (passedOptional / optionalFindings.length) * optionalWeight
        : optionalWeight;

      const quality = Math.round((requiredScore + optionalScore) * 100) / 100;
      const passed = passedRequired === requiredFindings.length;

      return {
        passed,
        quality,
        structuralFindings: findings,
        syntaxValid: true,
      };
    } catch (err) {
      return {
        passed: false,
        quality: 0,
        structuralFindings: [],
        syntaxValid: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Basic syntax validation. Checks for balanced braces, brackets,
   * and common syntax errors.
   */
  private checkSyntax(code: string, componentType: string): boolean {
    // Check balanced braces.
    let braceCount = 0;
    let bracketCount = 0;
    let parenCount = 0;
    let inString = false;
    let stringChar = "";

    for (let i = 0; i < code.length; i++) {
      const ch = code[i]!;
      const prev = i > 0 ? code[i - 1] : "";

      // Handle string boundaries (skip escaped chars).
      if (!inString && (ch === '"' || ch === "'" || ch === "`")) {
        inString = true;
        stringChar = ch;
      } else if (inString && ch === stringChar && prev !== "\\") {
        inString = false;
      }
      if (inString) continue;

      // Skip line comments.
      if (ch === "/" && code[i + 1] === "/") {
        const newlineIdx = code.indexOf("\n", i);
        i = newlineIdx === -1 ? code.length : newlineIdx;
        continue;
      }

      if (ch === "{") braceCount++;
      if (ch === "}") braceCount--;
      if (ch === "[") bracketCount++;
      if (ch === "]") bracketCount--;
      if (ch === "(") parenCount++;
      if (ch === ")") parenCount--;

      // Early exit on imbalance.
      if (braceCount < 0 || bracketCount < 0 || parenCount < 0) return false;
    }

    if (braceCount !== 0 || bracketCount !== 0 || parenCount !== 0) return false;

    // Component-type specific checks.
    if (componentType === "react") {
      // Must have a function or arrow component (export default or named).
      if (!/export\s+(default\s+)?(function|const)\s+\w+/i.test(code) &&
          !/export\s+default\s+\w+/i.test(code)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Built-in quality checks that apply to all component types.
   */
  private runBuiltInChecks(code: string, componentType: string): StructuralFinding[] {
    const findings: StructuralFinding[] = [];

    // Semantic HTML check.
    const semanticTags = ["<main", "<nav", "<header", "<footer", "<section", "<article", "<aside"];
    const hasSemantic = semanticTags.some((tag) => code.includes(tag));
    findings.push({
      label: "Uses semantic HTML elements",
      required: false,
      found: hasSemantic,
      pattern: semanticTags.join("|"),
    });

    // Accessibility check.
    const hasAria = /aria-\w+=/i.test(code) || /role=/i.test(code);
    findings.push({
      label: "Has accessibility attributes (aria-* or role)",
      required: false,
      found: hasAria,
      pattern: "aria-\\w+=|role=",
    });

    if (componentType === "react") {
      // React hooks check.
      const hasUseState = /useState\s*\(/i.test(code);
      const hasUseEffect = /useEffect\s*\(/i.test(code);
      findings.push({
        label: "Uses useState for state management",
        required: false,
        found: hasUseState,
        pattern: "useState\\s*\\(",
      });
      findings.push({
        label: "Uses useEffect for side effects",
        required: false,
        found: hasUseEffect,
        pattern: "useEffect\\s*\\(",
      });

      // Event handler check.
      const hasEventHandler = /on[A-Z]\w+\s*=\s*\{/i.test(code) || /addEventListener/i.test(code);
      findings.push({
        label: "Has event handlers",
        required: false,
        found: hasEventHandler,
        pattern: "on[A-Z]\\w+\\s*=|addEventListener",
      });

      // Key prop in lists.
      const hasKeyProp = /key\s*[:=]/i.test(code);
      findings.push({
        label: "Uses key prop for list rendering",
        required: false,
        found: hasKeyProp,
        pattern: "key\\s*[:=]",
      });
    }

    return findings;
  }
}
