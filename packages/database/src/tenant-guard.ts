/**
 * Tenant guard — centralizes multi-tenant access control helpers.
 *
 * All Pg* stores accept an optional tenantId. The pattern in this codebase
 * is: if the caller knows the tenant (always after JWT extraction), pass
 * it explicitly. This module prevents accidental cross-tenant data access
 * by:
 *   1. Requiring tenantId to come from a typed context, never raw input
 *   2. Validating tenantId shape (non-empty, no whitespace, length cap)
 *   3. Providing a `scoped()` helper that returns a frozen object the
 *      store methods accept, so the value can't be tampered with after
 *      construction
 *
 * This is a *defense-in-depth* layer. The primary isolation guarantee
 * comes from `WHERE tenant_id = ?` in every store query. The guard
 * catches mistakes at the application boundary (route handlers, plugins)
 * before they reach the store layer.
 */

export interface TenantContext {
  /** The authenticated tenant id (from JWT or session). */
  tenantId: string;
  /** Source of the context (for logging). */
  source: "jwt" | "session" | "header" | "system";
}

const TENANT_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
const RESERVED_TENANT_IDS = new Set(["", "anonymous", "null", "undefined", "system"]);

export class TenantGuardError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "TenantGuardError";
  }
}

/** Validate a tenant id before passing it to a store. */
export function validateTenantId(tenantId: string | null | undefined): string {
  if (tenantId === null || tenantId === undefined) {
    throw new TenantGuardError("tenant id is required", "TENANT_REQUIRED");
  }
  if (typeof tenantId !== "string") {
    throw new TenantGuardError("tenant id must be a string", "TENANT_TYPE");
  }
  if (RESERVED_TENANT_IDS.has(tenantId)) {
    throw new TenantGuardError(`tenant id "${tenantId}" is reserved`, "TENANT_RESERVED");
  }
  if (!TENANT_ID_PATTERN.test(tenantId)) {
    throw new TenantGuardError(
      `tenant id "${tenantId}" must match ${TENANT_ID_PATTERN} (alphanum, dash, underscore, 1-64 chars)`,
      "TENANT_FORMAT",
    );
  }
  return tenantId;
}

/** Build a typed context from a raw value. */
export function makeTenantContext(
  tenantId: string | null | undefined,
  source: TenantContext["source"] = "jwt",
): TenantContext {
  const id = validateTenantId(tenantId);
  return Object.freeze({ tenantId: id, source });
}

/**
 * Wrap a tenant id into an opaque, frozen scope object. The store methods
 * accept this directly, so the tenant id cannot be mutated between the
 * route handler and the store call.
 */
export function scoped(tenantId: string | null | undefined, source: TenantContext["source"] = "jwt"): Readonly<TenantContext> {
  return makeTenantContext(tenantId, source);
}

/** Assert that two scopes belong to the same tenant. Throws on mismatch. */
export function assertSameTenant(a: TenantContext, b: TenantContext): void {
  if (a.tenantId !== b.tenantId) {
    throw new TenantGuardError(
      `cross-tenant access blocked: ${a.tenantId} tried to access ${b.tenantId}`,
      "CROSS_TENANT",
    );
  }
}

/**
 * Sanitize a filter object — strips tenantId if it would override the
 * context. Prevents malicious query params from widening scope.
 */
export function sanitizeFilter<T extends Record<string, unknown>>(
  filter: T,
  ctx: TenantContext,
): T & { tenantId: string } {
  if ("tenantId" in filter && filter.tenantId !== ctx.tenantId) {
    throw new TenantGuardError(
      `filter tenantId "${filter.tenantId}" does not match context "${ctx.tenantId}"`,
      "CROSS_TENANT",
    );
  }
  return { ...filter, tenantId: ctx.tenantId };
}
