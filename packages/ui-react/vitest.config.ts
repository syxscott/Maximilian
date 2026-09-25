import { defineConfig } from "vitest/config"

// Unit tests for the generic primitives. They drive components through
// react-dom/client + jsdom directly (no testing-library dependency): the
// helpers in test/helpers.tsx wrap renders and native events in act().
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["test/**/*.test.{ts,tsx}"],
    passWithNoTests: true,
  },
})
