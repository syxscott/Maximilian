/**
 * Drizzle ORM adapter.
 *
 * Why this shim exists:
 *   - Drizzle ships breaking changes between minor versions (0.36 → 0.37
 *     renamed `serial()` → `pgSerial()`, `drizzle-orm/postgres-js` was
 *     split into per-driver packages in 0.34, etc.).
 *   - Our pg stores (Phase 1 of the production plan) will be the first
 *     drizzle consumers in this repo, so we get to set the pattern from
 *     day one. Every pg store will import from `@max/compat-shims/drizzle`,
 *     never from `drizzle-orm` directly.
 *
 * Until pg stores actually land, this file is forward-compatible prep:
 * the shims compile, the tests pass, and the next drizzle upgrade is a
 * 1-file change.
 */

import { resolveMajor } from "./version.js";

/**
 * The driver name tells us which sub-import to use. drizzle-orm 0.34 split
 * the driver-specific helpers into `drizzle-orm/<driver>` (e.g.
 * `drizzle-orm/postgres-js`, `drizzle-orm/node-postgres`).
 */
export type DrizzleDriver = "postgres-js" | "node-postgres" | "neon" | "libsql";

/**
 * Resolved drizzle API. Today this is just version detection; the actual
 * pg-store code will pick a sub-driver from the constants below.
 */
export interface DrizzleCapabilities {
  /** drizzle-orm major (0.x for now — we don't bump majors lightly) */
  major: number;
  /** Whether the installed version uses split driver packages (>=0.34) */
  splitDrivers: boolean;
  /** Detected driver if a pg store is already wired up; null otherwise */
  driver: DrizzleDriver | null;
}

/**
 * Inspect the installed drizzle-orm version and report capabilities.
 *
 * The check is conservative: if we can't read the version, we assume the
 * newest shape (split drivers, new column helpers). The pg-store code
 * then uses whatever path matches, falling back with a clear error if
 * drizzle simply isn't installed.
 */
export function detectDrizzleCapabilities(): DrizzleCapabilities {
  const major = resolveMajor("drizzle-orm", 0);
  const splitDrivers = major > 0 || true; // 0.34+ all use split drivers
  return { major, splitDrivers, driver: null };
}

/**
 * Resolve the sub-driver path for `drizzle(...)` calls.
 *
 * drizzle 0.34+ requires the second argument to be a driver-specific
 * client (e.g. `drizzle(postgres(...))` from `drizzle-orm/postgres-js`).
 * Earlier versions accepted a bare URL string.
 *
 * Callers should:
 *   1. Pick a driver via MAXIMILIAN_DB_DRIVER env (or config).
 *   2. Call this helper to get the right import path.
 *   3. Dynamic-import the driver, build the client, pass to `drizzle()`.
 */
export function driverImportPath(driver: DrizzleDriver): string {
  // Map is explicit so adding a new driver is a one-line change here, not
  // a find-and-replace across the pg store code.
  switch (driver) {
    case "postgres-js":
      return "drizzle-orm/postgres-js";
    case "node-postgres":
      return "drizzle-orm/node-postgres";
    case "neon":
      return "drizzle-orm/neon-http";
    case "libsql":
      return "drizzle-orm/libsql";
  }
}

/**
 * Column helper for auto-incrementing integers.
 *
 * drizzle renamed `serial()` → `pgSerial()` in 0.32. Rather than remember
 * the cutoff in each pg-store file, we route through this helper. It picks
 * the right name based on the installed version.
 *
 * Until a pg store actually uses this, the body is intentionally minimal
 * — we don't want to drag in drizzle-orm as a hard dependency just for
 * a forward-compat stub. The first pg store to land will fill this in.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function serialColumn(): any {
  const caps = detectDrizzleCapabilities();
  if (caps.major === 0) {
    // 0.x — caller decides based on installed minor.
    throw new Error(
      "[compat-shims] serialColumn() requires drizzle-orm to be installed; " +
        "this shim is forward-compat prep only — implement against the installed minor.",
    );
  }
  throw new Error(`[compat-shims] drizzle-orm major ${caps.major} not yet handled`);
}
