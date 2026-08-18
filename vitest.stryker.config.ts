// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Stryker mutation testing — vitest config.
 *
 * The mutation runner needs a vitest config that:
 *   - Runs ONLY the `@max/meta-system` package (the mutation target)
 *   - Disables coverage (Stryker tracks per-test coverage itself)
 *   - Excludes the mutated files from being treated as test sources
 *
 * Reference: https://stryker-mutator.io/docs/mutation-testing-elements/mutators/
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The mutation targets are in packages/meta-system/src. Vitest
    // picks up `*.test.ts` under that package by default.
    //
    // Stryker's vitest-runner spawns vitest in a sandbox under
    // `.stryker-tmp/sandbox-XXX/` and passes the *root* config path,
    // but the cwd of the vitest process may be the package root
    // (because vitest resolves includes from the config file's
    // directory by default in some versions). To be safe we list the
    // include glob as both the package-root relative path AND the
    // full repo-root path. Vitest deduplicates.
    include: [
      "test/**/*.test.ts",
      "packages/meta-system/test/**/*.test.ts",
    ],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/coverage/**",
      "**/.stryker-tmp/**",
      "**/research/**",
    ],
    coverage: {
      enabled: false,
    },
    // Mutation tests can run for a long time; cap each test at 30s.
    testTimeout: 30_000,
    // Run serially within a single test file so mutation coverage
    // analysis is deterministic.
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});