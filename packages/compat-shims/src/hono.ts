/**
 * Hono adapter.
 *
 * Hono is fairly stable, but the middleware registration API has shifted
 * subtly between v3 → v4 (`app.use()` middleware order matters differently
 * with the new context propagation). This shim gives us one place to
 * re-pin that.
 *
 * Today the Maximilian API uses Hono 4.x directly via `apps/api/src/index.ts`.
 * The recommended migration is to consume `useHonoApp()` here rather than
 * `new Hono()` directly. Until that migration lands, this file exists so
 * the upgrade CI workflow has a target.
 */

import { createRequire } from "node:module";

import { resolveMajor } from "./version.js";

const cjsRequire = createRequire(import.meta.url);

/**
 * Hono's `Hono` class is generic over the env shape (Bindings, Variables).
 * We pass them through transparently.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type HonoClass<E extends Record<string, unknown> = Record<string, unknown>> = any;

/**
 * Resolve the right `Hono` constructor to use, based on the installed
 * version. Today: just `import { Hono } from "hono"`. When hono 5 lands,
 * we add a branch here.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useHonoApp<E extends Record<string, unknown> = Record<string, unknown>>(): HonoClass<E> {
  const honoMajor = resolveMajor("hono", 4);
  if (honoMajor >= 5) {
    // Reserved for hono 5 migration. The Hono() constructor is stable across
    // majors, so we just hand back the import.
    return requireHono().Hono;
  }
  return requireHono().Hono;
}

/**
 * The error-handler contract we use across the API.
 *
 * Hono v4 changed `c.json({ error })` vs `c.json({ msg })` defaults; we
 * standardize on `{ error, code, details? }` so the frontend doesn't need
 * to special-case versions.
 */
export interface StandardErrorBody {
  error: string;
  code?: string;
  details?: unknown;
}

/**
 * Wrap a thrown error into the standard shape. We intentionally do NOT
 * call `c.json` here — that depends on the Hono context, which we don't
 * import. Caller composes the two.
 */
export function toStandardError(err: unknown): StandardErrorBody {
  if (err instanceof Error) {
    return {
      error: err.message,
      code: (err as { code?: string }).code,
      details: (err as { details?: unknown }).details,
    };
  }
  return { error: String(err) };
}

/**
 * Internal: lazy-load Hono. `createRequire` for the same reason as ink.ts.
 */
function requireHono(): { Hono: unknown } {
  return cjsRequire("hono") as { Hono: unknown };
}
