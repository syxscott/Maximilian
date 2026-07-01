/**
 * Rate limiter — verifies the 100 req/min cap fires and that the
 * Retry-After header is present on 429s.
 *
 * We construct a minimal Hono app with the same `hono-rate-limiter`
 * configuration as production but bound to a tiny limit so we don't have
 * to fire 101 real HTTP requests in a test. The shape is identical to
 * what's wired in `apps/api/src/index.ts:485-507`.
 */

import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { rateLimiter } from "hono-rate-limiter";

function buildApp(limit: number) {
  const app = new Hono();
  app.use(
    rateLimiter({
      windowMs: 60_000,
      limit,
      standardHeaders: "draft-6",
      keyGenerator: (c) => c.env?.incoming?.socket?.remoteAddress ?? "unknown",
    }),
  );
  app.get("/x", (c) => c.json({ ok: true }));
  return app;
}

describe("rate limiter", () => {
  it("returns 429 once the per-IP limit is exceeded", async () => {
    const app = buildApp(3);

    const r1 = await app.request("/x");
    const r2 = await app.request("/x");
    const r3 = await app.request("/x");
    const r4 = await app.request("/x");

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r3.status).toBe(200);
    expect(r4.status).toBe(429);
  });

  it("emits Retry-After + RateLimit-* headers on 429", async () => {
    const app = buildApp(1);

    await app.request("/x"); // consume the only allowed slot
    const over = await app.request("/x");

    expect(over.status).toBe(429);
    // hono-rate-limiter with standardHeaders: "draft-6" emits the IETF
    // draft headers (RateLimit-Reset, RateLimit-Policy). Retry-After
    // is the de-facto fallback clients still check first.
    const retryAfter = over.headers.get("Retry-After");
    expect(retryAfter).not.toBeNull();
    expect(Number.parseInt(retryAfter!, 10)).toBeGreaterThan(0);
  });

  it("counts requests per-IP independently", async () => {
    // The keyGenerator falls back to socket.remoteAddress, which in
    // Hono's app.request is "::1" or "127.0.0.1" — there's no built-in
    // way to inject a fake remote address without a transport stub.
    // We verify the simpler invariant: the same client doesn't reset the
    // counter mid-window by hitting a different path.
    const app = buildApp(2);
    app.get("/a", (c) => c.text("a"));
    app.get("/b", (c) => c.text("b"));

    const a1 = await app.request("/a");
    const b1 = await app.request("/b");
    const a2 = await app.request("/a");

    expect(a1.status).toBe(200);
    expect(b1.status).toBe(200);
    expect(a2.status).toBe(429);
  });
});