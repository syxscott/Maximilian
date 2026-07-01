/**
 * Upstream version detection + capability flags.
 *
 * The whole point of `@max/compat-shims` is to absorb upstream API
 * drift in one place. This module is the single source of truth for
 * "which version of X are we on, and what can we safely call?"
 *
 * Design:
 *   - We read version strings from `package.json` of installed packages
 *     (via Node's `require.resolve` + `JSON.parse`). This is fast (~ms),
 *     pure read, and cacheable at the module level.
 *   - We never `import` the upstream package from this file — that would
 *     force a hard dep and defeat the purpose of optional peer deps. The
 *     detection works whether or not the package is actually installed.
 *   - `featureFlag(name, default)` lets consumers do runtime branching
 *     without scattering `process.env.X` checks across the codebase.
 *
 * When an upstream package moves to a new major:
 *   1. Bump its `peerDependency` in this package's package.json.
 *   2. Add the new version to `KNOWN_VERSIONS` here.
 *   3. Add a branch in the relevant adapter (`ink.ts`, `drizzle.ts`, etc.).
 *   4. Add a test case in `test/version.test.ts`.
 * No other file in the repo should need to change.
 */

import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const require = createRequire(import.meta.url);

/**
 * Coarse version bucket. We intentionally collapse patch + minor into the
 * major so the adapter layer doesn't need an O(n) switch on every call.
 */
export type MajorVersion = number;

/**
 * Read the installed version of an upstream package without importing it.
 * Returns null when the package isn't installed (optional peer dep).
 *
 * Implementation notes:
 *   - Uses `require.resolve("<pkg>/package.json")` first; falls back to
 *     `node_modules/<pkg>/package.json` lookup for monorepos where the
 *     package might be hoisted in different locations.
 *   - Never throws — if we can't find it, we return null and the caller
 *     uses its default branch.
 */
export function detectVersion(pkg: string): MajorVersion | null {
  try {
    const pkgJsonPath = require.resolve(`${pkg}/package.json`);
    const raw = readFileSync(pkgJsonPath, "utf8");
    const parsed = JSON.parse(raw) as { version?: string };
    if (typeof parsed.version !== "string") return null;
    const major = Number.parseInt(parsed.version.split(".")[0] ?? "", 10);
    return Number.isFinite(major) ? major : null;
  } catch {
    // Fallback: walk up looking for node_modules/<pkg>/package.json.
    try {
      let dir = dirname(new URL(import.meta.url).pathname);
      for (let i = 0; i < 6; i++) {
        const candidate = resolve(dir, "node_modules", pkg, "package.json");
        if (existsSync(candidate)) {
          const raw = readFileSync(candidate, "utf8");
          const parsed = JSON.parse(raw) as { version?: string };
          if (typeof parsed.version === "string") {
            const major = Number.parseInt(parsed.version.split(".")[0] ?? "", 10);
            return Number.isFinite(major) ? major : null;
          }
        }
        dir = dirname(dir);
      }
    } catch {
      /* swallow — return null */
    }
    return null;
  }
}

/**
 * Resolve the active major, falling back to a sensible default when the
 * upstream isn't installed. The default is chosen to match the version we
 * currently depend on, so new consumers get the tested path.
 */
export function resolveMajor(pkg: string, fallback: MajorVersion): MajorVersion {
  return detectVersion(pkg) ?? fallback;
}

/**
 * Runtime feature flag. Reads from MAXIMILIAN_FEATURE_<NAME> (1/0/true/false)
 * and falls back to the supplied default.
 *
 * Why env vars instead of a config table:
 *   - Operators can flip flags without rebuilding (Kubernetes ConfigMap, etc.)
 *   - Tests can stub per-flag without touching a shared registry
 *   - No new module to import just to ask "is this on?"
 */
export function featureFlag(name: string, defaultValue: boolean): boolean {
  const raw = process.env[`MAXIMILIAN_FEATURE_${name.toUpperCase()}`];
  if (raw === undefined) return defaultValue;
  return raw === "1" || raw.toLowerCase() === "true";
}

/**
 * Known major versions, captured here so adapters can write exhaustive
 * switches. Add a new entry when an upstream ships a new major; the TS
 * compiler will then flag any adapter that hasn't been updated.
 */
export const KNOWN_MAJORS = {
  ink: [5, 6] as const,
  hono: [3, 4] as const,
  drizzle: [0] as const, // 0.x — we track minor in the adapter
  openai: [4] as const,
  anthropic: [0] as const, // 0.x — same
} as const;

export type KnownPackage = keyof typeof KNOWN_MAJORS;
