/**
 * Security headers — verifies the standard hardening headers are present
 * on every response. Smoke-tested against a minimal Hono app so we don't
 * have to boot the full API + DB just to check header presence.
 */

import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { securityHeaders } from "../src/middleware/security-headers";

function buildApp() {
  const app = new Hono();
  app.use("*", securityHeaders());
  app.get("/x", (c) => c.json({ ok: true }));
  return app;
}

describe("security headers", () => {
  it("emits the standard hardening headers on a JSON response", async () => {
    const app = buildApp();
    const res = await app.request("/x");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(res.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(res.headers.get("Permissions-Policy")).toContain("camera=()");
    expect(res.headers.get("Content-Security-Policy")).toContain("default-src 'none'");
    expect(res.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
  });

  it("does not set HSTS for localhost (dev) so plain HTTP still works", async () => {
    const app = buildApp();
    const res = await app.request("/x", {
      headers: { Host: "localhost:3001" },
    });
    expect(res.headers.get("Strict-Transport-Security")).toBeNull();
  });

  it("sets HSTS for non-local hosts (production)", async () => {
    const app = buildApp();
    const res = await app.request("https://api.example.com/x");
    expect(res.headers.get("Strict-Transport-Security")).toBe(
      "max-age=31536000; includeSubDomains",
    );
  });
});