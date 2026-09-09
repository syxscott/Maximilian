// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Phase 8 — coverage configuration for `@max/core`.
 *
 * Thresholds are intentionally conservative: the goal is a baseline that
 * catches *catastrophic* regressions (a refactor that drops lines),
 * not a per-PR gate. A future phase may tighten them once we have
 * enough history to set realistic targets.
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.{test,spec}.ts",
        "src/**/*.d.ts",
        "src/**/index.ts",
        // Tooling — no executable behaviour worth covering
        "src/opencode-executor.ts", // heavily exercised by tests but not in scope for this baseline
      ],
      thresholds: {
        lines: 60,
        functions: 60,
        branches: 50,
        statements: 60,
      },
    },
  },
});