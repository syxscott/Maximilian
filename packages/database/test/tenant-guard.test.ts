/**
 * Tests for tenant-guard — multi-tenant access control helpers.
 *
 * The test uses an in-memory mock that simulates the isolation contract
 * that real Pg* stores must satisfy. This lets us verify the guard logic
 * without a live Postgres.
 */

import { describe, it, expect } from "vitest";
import {
  validateTenantId, makeTenantContext, scoped, assertSameTenant, sanitizeFilter,
  TenantGuardError,
} from "../src/tenant-guard.js";

describe("validateTenantId", () => {
  it("accepts well-formed ids", () => {
    expect(validateTenantId("tenant-1")).toBe("tenant-1");
    expect(validateTenantId("abc_DEF-123")).toBe("abc_DEF-123");
    expect(validateTenantId("a")).toBe("a");
    expect(validateTenantId("a".repeat(64))).toBe("a".repeat(64));
  });

  it("rejects empty / null / undefined", () => {
    expect(() => validateTenantId("")).toThrow(TenantGuardError);
    expect(() => validateTenantId(null)).toThrow(TenantGuardError);
    expect(() => validateTenantId(undefined)).toThrow(TenantGuardError);
  });

  it("rejects reserved names", () => {
    expect(() => validateTenantId("anonymous")).toThrow(/reserved/);
    expect(() => validateTenantId("system")).toThrow(/reserved/);
    expect(() => validateTenantId("null")).toThrow(/reserved/);
  });

  it("rejects names with special chars or too long", () => {
    expect(() => validateTenantId("tenant 1")).toThrow(/must match/);
    expect(() => validateTenantId("tenant.1")).toThrow(/must match/);
    expect(() => validateTenantId("a".repeat(65))).toThrow(/must match/);
    expect(() => validateTenantId("<script>")).toThrow(/must match/);
    expect(() => validateTenantId("tenant'; DROP TABLE users;--")).toThrow(/must match/);
  });
});

describe("makeTenantContext / scoped", () => {
  it("freezes the context", () => {
    const ctx = makeTenantContext("acme");
    expect(Object.isFrozen(ctx)).toBe(true);
    expect(ctx.tenantId).toBe("acme");
    expect(ctx.source).toBe("jwt");
  });

  it("accepts different sources", () => {
    expect(scoped("acme", "session").source).toBe("session");
    expect(scoped("acme", "header").source).toBe("header");
    expect(scoped("acme", "system").source).toBe("system");
  });

  it("refuses to construct a context with an invalid id", () => {
    expect(() => makeTenantContext("")).toThrow(TenantGuardError);
    expect(() => scoped("bad id")).toThrow(TenantGuardError);
  });
});

describe("assertSameTenant", () => {
  it("passes for matching tenants", () => {
    const a = makeTenantContext("acme");
    const b = makeTenantContext("acme");
    expect(() => assertSameTenant(a, b)).not.toThrow();
  });

  it("throws on mismatch", () => {
    const a = makeTenantContext("acme");
    const b = makeTenantContext("other");
    expect(() => assertSameTenant(a, b)).toThrow(/cross-tenant/i);
  });
});

describe("sanitizeFilter", () => {
  it("injects the context tenantId when missing", () => {
    const ctx = makeTenantContext("acme");
    const out = sanitizeFilter({ status: "active" }, ctx);
    expect(out.tenantId).toBe("acme");
    expect(out.status).toBe("active");
  });

  it("accepts matching tenantId", () => {
    const ctx = makeTenantContext("acme");
    const out = sanitizeFilter({ tenantId: "acme", status: "active" }, ctx);
    expect(out.tenantId).toBe("acme");
  });

  it("rejects mismatched tenantId (cross-tenant probe attempt)", () => {
    const ctx = makeTenantContext("acme");
    expect(() => sanitizeFilter({ tenantId: "other" }, ctx)).toThrow(/does not match context/);
  });
});

describe("isolation simulation", () => {
  it("store-like mock with tenant filter only returns own rows", () => {
    // Simulated store that respects tenant filter contract
    const data = [
      { id: "w1", tenantId: "acme" },
      { id: "w2", tenantId: "acme" },
      { id: "w3", tenantId: "beta" },
    ];
    const fakeStore = {
      list(filter: { tenantId: string }) {
        return data.filter((row) => row.tenantId === filter.tenantId);
      },
    };

    const acmeCtx = scoped("acme");
    const betaCtx = scoped("beta");

    const acmeRows = fakeStore.list(sanitizeFilter({}, acmeCtx));
    const betaRows = fakeStore.list(sanitizeFilter({}, betaCtx));

    expect(acmeRows.map((r) => r.id).sort()).toEqual(["w1", "w2"]);
    expect(betaRows.map((r) => r.id).sort()).toEqual(["w3"]);

    // Critical: even if a malicious client crafts a query with the wrong
    // tenant, sanitizeFilter rejects it.
    expect(() => fakeStore.list(sanitizeFilter({ tenantId: "acme" } as { tenantId: string }, betaCtx))).toThrow();
  });
});

// ── Phase 10 — SQL injection + advanced threat coverage ─────────────────────

describe("Phase 10 — SQL injection attack vectors", () => {
  /**
   * The validateTenantId regex `/^[a-zA-Z0-9_-]{1,64}$/` blocks every
   * common SQL injection shape. These tests enumerate the canonical
   * payloads (OWASP) to lock down the defense against regressions.
   */
  const SQL_INJECTION_PAYLOADS = [
    // Classic quote-stacking
    `tenant'; DROP TABLE users;--`,
    `tenant' OR '1'='1`,
    `' OR 1=1--`,
    `admin'--`,
    // Union-based
    `' UNION SELECT NULL,NULL,NULL--`,
    `' UNION ALL SELECT NULL--`,
    // Stacked queries
    `tenant'; UPDATE users SET admin=true WHERE id=1;--`,
    // Comment truncation (use /* */ form which contains /)
    `tenant/*`,
    // Encoding attempts (contain non-regex chars)
    `tenant%00admin`,
    // Path traversal
    `../../../etc/passwd`,
    // LDAP / NoSQL
    `tenant*`,
    `{$ne:null}`,
    // Whitespace injection
    `tenant 1`,
    `tenant\t1`,
    `tenant\n1`,
  ];

  for (const payload of SQL_INJECTION_PAYLOADS) {
    it(`rejects SQL injection payload: ${JSON.stringify(payload)}`, () => {
      expect(() => validateTenantId(payload)).toThrow(TenantGuardError);
      expect(() => scoped(payload)).toThrow(TenantGuardError);
      expect(() => makeTenantContext(payload)).toThrow(TenantGuardError);
    });
  }

  it("rejects tenant ids that pass regex but are reserved", () => {
    // Reserved names are blocked even though they match the regex
    expect(() => validateTenantId("system")).toThrow(/reserved/);
    expect(() => validateTenantId("anonymous")).toThrow(/reserved/);
    expect(() => validateTenantId("null")).toThrow(/reserved/);
    expect(() => validateTenantId("undefined")).toThrow(/reserved/);
  });

  it("rejects extremely long tenant ids (DoS resistance)", () => {
    const longId = "a".repeat(10_000);
    expect(() => validateTenantId(longId)).toThrow(/must match/);
  });
});

describe("Phase 10 — cross-tenant probe via sanitizeFilter bypass attempts", () => {
  it("rejects falsy-but-not-undefined tenant id in filter", () => {
    const ctx = makeTenantContext("acme");
    // 0 / false / "" — all should be rejected because they don't match ctx
    expect(() => sanitizeFilter({ tenantId: "" as unknown as string }, ctx)).toThrow();
    expect(() => sanitizeFilter({ tenantId: 0 as unknown as string }, ctx)).toThrow();
    expect(() => sanitizeFilter({ tenantId: null as unknown as string }, ctx)).toThrow();
  });

  it("rejects prototype-pollution attempts in filter", () => {
    const ctx = makeTenantContext("acme");
    // attacker tries to slip in __proto__
    const malicious = JSON.parse(
      `{"__proto__": {"tenantId": "evil"}, "tenantId": "acme"}`,
    );
    // The function doesn't recursively sanitize __proto__, but
    // tenantId matching wins. Confirm the ctx tenantId is what comes
    // out, not the proto one.
    const out = sanitizeFilter(malicious, ctx);
    expect(out.tenantId).toBe("acme");
  });

  it("freezes the context so post-construction tampering is impossible", () => {
    const ctx = scoped("acme");
    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (ctx as any).tenantId = "evil";
    }).toThrow();
    expect(ctx.tenantId).toBe("acme");
  });
});
