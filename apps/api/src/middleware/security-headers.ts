import type { Context, Next } from "hono";

/**
 * Security headers middleware for Hono.
 * Adds standard security headers to all responses.
 */
export function securityHeaders() {
  return async (c: Context, next: Next) => {
    await next();
    c.header("X-Content-Type-Options", "nosniff");
    c.header("X-Frame-Options", "DENY");
    c.header("X-XSS-Protection", "1; mode=block");
    c.header("Referrer-Policy", "strict-origin-when-cross-origin");
    c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    c.header(
      "Content-Security-Policy",
      "default-src 'none'; frame-ancestors 'none'",
    );
    // Only add HSTS in production (not localhost / 127.0.0.1) — HSTS on
    // localhost causes browsers to refuse plain-HTTP connections and
    // breaks local dev.
    const host = new URL(c.req.url).hostname;
    const isLocal = host === "localhost" || host === "127.0.0.1" || host === "::1";
    if (!isLocal) {
      c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
  };
}
