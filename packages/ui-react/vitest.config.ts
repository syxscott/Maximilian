import { defineConfig } from "vitest/config";

// This package is a port of OpenCode's React component library. It has no
// tests of its own yet — the dashboard exercises the components end-to-end via
// @testing-library/react. Mark `passWithNoTests` so `pnpm -r test` doesn't fail
// when no test files exist in this workspace.
export default defineConfig({
  test: {
    passWithNoTests: true,
  },
});
