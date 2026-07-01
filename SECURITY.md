# Security Policy

## Supported versions

The following Maximilian release lines receive security updates:

| Version | Supported | Notes |
|---------|-----------|-------|
| 0.1.x (current) | ✓ active | production-readiness push — auth, PG, isolation, rate limits |
| < 0.1.0 | ✗ | pre-production; no security backports |

## Reporting a vulnerability

**Do not** file a public issue for suspected security vulnerabilities.

Email: **security@maximilian.example** (replace with the team's
production address — keep this on a monitored alias, not a personal inbox).

Include in the report:

- A clear description of the vulnerability and its impact
- A reproducer (commands, requests, configuration) — without it we can
  only guess at severity
- The Maximilian version (`git rev-parse HEAD` or `pnpm list @max/api`)
- Your assessment of impact (data exposure, RCE, DoS, auth bypass, …)

If you have an encrypted channel preference (e.g. PGP), include your
key fingerprint in the first message and we'll switch channels.

## Response targets

- **Acknowledgement** within 3 business days
- **Triage and severity assessment** within 7 days
- **Patch or mitigation** in this window after triage:
  - Critical (RCE, auth bypass, data exfiltration): 7 days
  - High (significant data exposure, privilege escalation): 30 days
  - Medium (limited exposure, requires specific conditions): 60 days
  - Low (informational, hardening): best-effort, in next minor release

These are **targets**, not guarantees. We'll communicate proactively if
a fix takes longer than the target window.

## Disclosure policy

We follow **coordinated disclosure**:

1. Reporter sends details to `security@…`.
2. We confirm, triage, and develop a fix in a private branch.
3. We agree on a disclosure date with the reporter — typically
   90 days from report, or earlier if a fix is ready and the impact
   is contained.
4. At the disclosure date we release the fix in a public commit and
   publish a SECURITY ADVISORY in `docs/security/` (GHSA ID when
   published via GitHub).
5. We credit the reporter in the advisory (unless they prefer
   anonymity).

## Scope — what's in

| Asset | In scope |
|---|---|
| `apps/api/` and all HTTP routes | ✓ |
| `apps/worker/` (BullMQ consumer) | ✓ |
| `packages/database/` (PG stores) | ✓ |
| `packages/auth/` and JWT/refresh logic | ✓ |
| `packages/providers/` (LLM client retry, rate-limit) | ✓ |
| `packages/core/` runtime (permission gate, sink) | ✓ |
| `docker-compose.yml`, `Dockerfile`s | ✓ |
| GitHub Actions workflows | ✓ |
| Demo / example scripts in `scripts/` | limited |
| `docs/` documentation | ✗ (no code execution) |
| Issues filed publicly before coordinated disclosure | n/a — please don't |

## Scope — what's out

- Vulnerabilities in **third-party dependencies** that have their own
  disclosure process — file with the upstream maintainer and copy us.
- **Social engineering** of Maximilian maintainers.
- **Volumetric DoS** of the Maximilian demo deployment.
- **Self-XSS** in the dashboard.
- Reports requiring **physical access** to a server the reporter
  doesn't own.

## Hardening guidance for operators

These are not vulnerabilities, but operators should ensure they are
configured correctly:

- **Always set `JWT_SECRET`** in production (`NODE_ENV=production`
  refuses to start without it).
- **Set `TRUSTED_PROXIES`** to your reverse proxy CIDR if you run
  behind nginx/ALB — otherwise `X-Forwarded-For` is ignored and rate
  limits use the socket peer.
- **Set `CORS_ORIGIN`** to the dashboard's exact origin (not `*`).
- **Use `ADMIN_TOKEN`** for `/api/metrics` access, not a long-lived JWT.
- **Rotate `JWT_SECRET`** periodically; this invalidates all access
  tokens but refresh tokens remain valid until they expire (default 7d).
- **Restrict `/api/docs`** in production via reverse proxy if you don't
  want to expose the OpenAPI spec publicly.
- **PostgreSQL credentials** in `DATABASE_URL` should be a low-privilege
  user — Maximilian only needs `SELECT/INSERT/UPDATE/DELETE` on the
  application tables.

## Security-related configuration

| Env var | Purpose | Default | Production guidance |
|---|---|---|---|
| `JWT_SECRET` | HS256 signing key | unset → no auth | **required**, ≥ 32 bytes random |
| `ADMIN_TOKEN` | bearer token for `/api/metrics` and dev auth | unset | use a long random string |
| `TRUSTED_PROXIES` | CIDR list of reverse proxies | empty (no header trust) | set to your proxy subnet |
| `CORS_ORIGIN` | allowed browser origin | `http://localhost:5174` | set to dashboard origin |
| `DATABASE_URL` | PG connection string | unset → file storage | use SSL (`?sslmode=require`) |
| `RATE_LIMIT` | request / minute / IP | 100 | tune per instance size |
| `WORKER_CONCURRENCY` | jobs / worker | 3 | scale with worker count |

## Acknowledgements

Vulnerability reporters are credited in the SECURITY ADVISORY unless they
request anonymity. Past reports (if any) are listed in
`docs/security/REPORTS.md`.
