// ESLint flat config — root level. Per-package overrides live in
// `<pkg>/eslint.config.js` and are merged by the lint script.
//
// Rules are deliberately permissive: this is an OSS project with
// contributions from many sources (Kosmos, AutoGen, OpenAI Agents, etc.)
// and we don't want to bikeshed style. The CI fails only on bugs.

import tseslint from "@typescript-eslint/eslint-plugin"
import tsparser from "@typescript-eslint/parser"

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/coverage/**",
      "**/.turbo/**",
      "**/*.d.ts",
      "apps/dashboard/dist/**",
    ],
  },
  {
    files: ["**/*.{ts,tsx,js,mjs}"],
    languageOptions: {
      parser: tsparser,
      ecmaVersion: 2024,
      sourceType: "module",
      globals: {
        console: "readonly",
        process: "readonly",
        Buffer: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        setImmediate: "readonly",
        global: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      // Possible bugs — fail CI
      "no-debugger": "error",
      "no-console": ["warn", { allow: ["warn", "error", "info"] }],
      "no-undef": "off", // TS handles this
      "no-unused-vars": "off", // TS handles this via noUnusedLocals
      "no-unused-expressions": "off", // TS handles this
      "prefer-const": "warn",
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-var": "error",

      // Style — only warn, don't fail
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/ban-ts-comment": ["warn", { "ts-ignore": "allow-with-description" }],
    },
  },
  {
    // Tests get a pass on `any` and unused vars — fixtures are noisy.
    files: ["**/test/**", "**/*.test.ts", "**/*.spec.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  {
    // Config files are sometimes plain JS — relax there too.
    files: ["**/*.config.{js,mjs,cjs}", "scripts/**"],
    rules: {
      "no-console": "off",
    },
  },
]
