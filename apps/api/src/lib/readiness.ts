/**
 * Readiness probes for Kubernetes.
 *
 * Each probe runs in isolation and reports `{ name, ok, latencyMs?, error? }`.
 * The K8s readiness endpoint hits all probes in parallel and gates traffic on
 * `every(check.ok)`. Probes must:
 *   - Complete in <2s each (we wrap postgres with an explicit timeout)
 *   - Never throw — convert failures into `{ ok: false, error }`
 *   - Be idempotent / side-effect free
 *
 * Kept separate from `apps/api/src/index.ts` so the probes can be unit-tested
 * with mocked dependencies.
 */

import { access as fsAccess, constants as fsConstants, mkdir as fsMkdir } from "node:fs/promises"

export interface ReadinessCheck {
  name: string
  ok: boolean
  latencyMs?: number
  error?: string
}

/**
 * Probe Postgres. Pass `db = null` when no client is wired up (the API falls
 * back to file storage in that case and we want to report it as healthy).
 */
export async function probePostgres(opts: {
  db: { execute: (q: unknown) => Promise<unknown> } | null
  databaseUrl: string | undefined
  /** Test seam: replace the query runner with a fake for unit tests. */
  runQuery?: () => Promise<unknown>
}): Promise<ReadinessCheck> {
  if (!opts.databaseUrl) {
    return { name: "postgres", ok: true, error: "DATABASE_URL unset; file storage in use" }
  }
  if (!opts.db) {
    return { name: "postgres", ok: false, error: "DATABASE_URL set but db client missing" }
  }
  const start = Date.now()
  try {
    if (opts.runQuery) {
      await Promise.race([
        opts.runQuery(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("postgres probe timed out")), 2000),
        ),
      ])
    } else {
      // We don't import drizzle's `sql` tag here — the caller passes the
      // actual query runner. This keeps the probe module side-effect-free.
      await Promise.race([
        opts.db.execute(undefined),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("postgres probe timed out")), 2000),
        ),
      ])
    }
    return { name: "postgres", ok: true, latencyMs: Date.now() - start }
  } catch (err) {
    return {
      name: "postgres",
      ok: false,
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * Probe LLM providers. We don't actually call the API (that would burn tokens
 * on every K8s probe) — configured providers are sufficient for readiness.
 * Liveness/health is where deeper checks belong.
 */
export function probeLlm(providerCount: number): ReadinessCheck {
  if (providerCount === 0) {
    return { name: "llm", ok: false, error: "no providers configured" }
  }
  return { name: "llm", ok: true, error: `${providerCount} provider(s) configured` }
}

/**
 * Probe workspace directory writability.
 *
 * The default WORKSPACE_DIR (`./workspaces`) is gitignored, so a fresh CI
 * checkout's `probeWorkspaceDir` would otherwise fail with ENOENT. We try
 * `mkdir -p` first and only fail if it can't materialize the dir — that's
 * what's actually broken vs. just "haven't made the dir yet".
 */
export async function probeWorkspaceDir(path: string): Promise<ReadinessCheck> {
  const start = Date.now()
  try {
    await fsAccess(path, fsConstants.W_OK)
    return { name: "workspace_dir", ok: true, latencyMs: Date.now() - start }
  } catch (accessErr) {
    if (accessErr instanceof Error && (accessErr as NodeJS.ErrnoException).code === "ENOENT") {
      try {
        await fsMkdir(path, { recursive: true })
        await fsAccess(path, fsConstants.W_OK)
        return { name: "workspace_dir", ok: true, latencyMs: Date.now() - start }
      } catch (mkdirErr) {
        return {
          name: "workspace_dir",
          ok: false,
          latencyMs: Date.now() - start,
          error: mkdirErr instanceof Error ? mkdirErr.message : String(mkdirErr),
        }
      }
    }
    return {
      name: "workspace_dir",
      ok: false,
      latencyMs: Date.now() - start,
      error: accessErr instanceof Error ? accessErr.message : String(accessErr),
    }
  }
}

/**
 * Run all probes in parallel and return the aggregate. Returns
 * `{ ok: true }` iff every probe passed; the caller picks the HTTP status.
 */
export async function runReadinessChecks(opts: {
  db: { execute: (q: unknown) => Promise<unknown> } | null
  databaseUrl: string | undefined
  providerCount: number
  workspaceDir: string
  /** Test seam. */
  runQuery?: () => Promise<unknown>
}): Promise<{ ok: boolean; checks: ReadinessCheck[] }> {
  const [postgres, llm, workspaceDirCheck] = await Promise.all([
    probePostgres({ db: opts.db, databaseUrl: opts.databaseUrl, runQuery: opts.runQuery }),
    Promise.resolve(probeLlm(opts.providerCount)),
    probeWorkspaceDir(opts.workspaceDir),
  ])
  const checks = [postgres, llm, workspaceDirCheck]
  return { ok: checks.every((c) => c.ok), checks }
}
