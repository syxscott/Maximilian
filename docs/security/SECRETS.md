# Secrets Management

**Owner**: Platform team
**Effective from**: 2026-08-18 (Phase 10)
**Review cadence**: Quarterly

This document describes how Maximilian handles secrets — what's stored
where, how secrets are rotated, who can read them, and what to do when a
secret leaks.

---

## Inventory

| Secret | Required? | Where stored | Who can read |
| ------ | --------- | ------------ | ------------ |
| `JWT_SECRET` | Yes | K8s Secret (base) or External Secrets Operator (prod) | API process |
| `JWT_REFRESH_SECRET` | Yes | Same as above | API process |
| `OPENCODE_BASE_URL` | No (default `http://127.0.0.1:4096`) | env | API + worker |
| `DATABASE_URL` | Yes | K8s Secret / External Secrets Operator | API + worker |
| `ANTHROPIC_API_KEY` (per provider) | Conditional | K8s Secret, one per provider | API + worker |
| `OPENAI_API_KEY` | Conditional | Same as above | API + worker |
| `MINIMAX_API_KEY` (Chinese vendors) | Conditional | Same as above | API + worker |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | No (uses debug by default) | env | API + worker |
| `HONEYCOMB_API_KEY` | No (production optional) | K8s Secret | API |
| `GRAFANA_CLOUD_AUTH` | No (production optional) | K8s Secret | API |

The full inventory (including all 9 Chinese vendor keys) lives in
`packages/providers/src/presets/data.ts`.

---

## Storage tiers

### Tier 1 — Local dev (no security boundary)

`.env` files in `.gitignore`. Used for local hacking. Never deployed.

### Tier 2 — Staging / preview

K8s `Secret` manifests in `deploy/k8s/base/secret.yaml`. The values are
**placeholder** (`REPLACE_ME_BASE64`). Operators replace them via
`kubectl create secret` or `kustomize edit`.

```bash
# Create the secret from a local file
kubectl create secret generic maximilian-secrets \
  --from-env-file=.env.production \
  --namespace=maximilian-staging
```

### Tier 3 — Production

[External Secrets Operator](https://external-secrets.io/) syncing from AWS
Secrets Manager / HashiCorp Vault. The k8s `Secret` becomes a
read-only mirror of the upstream. ESO rotates the secret in-place; the
deployment doesn't need to restart.

TODO (Phase 11+): wire ESO + AWS Secrets Manager. Today the operator
manually edits the K8s `Secret` after rotation (acceptable for staging,
not acceptable for prod).

---

## Rotation policy

| Secret | Rotation cadence | Method |
| ------ | ---------------- | ------ |
| `JWT_SECRET` | 90 days | Generate new HMAC secret, deploy with 2-secret dual-window sign/verify, force re-login by rotating refresh secret |
| `JWT_REFRESH_SECRET` | 90 days (offset +7 days from access) | Same as above |
| `DATABASE_URL` | 180 days | Rotate Postgres password, update both K8s Secret and DSN references |
| Provider API keys | 180 days | Generate in vendor dashboard, update K8s Secret |
| `OPENCODE_BASE_URL` | n/a (config, not secret) | n/a |

A secret is **compromised** (not just due for rotation) when:

- The K8s `Secret` was logged to stdout by mistake
- A dev committed `.env.production` to git
- An ex-employee had access to the cluster

In all three cases: rotate immediately + invalidate all live tokens +
add an entry to `docs/operations/post-mortem-template.md`.

---

## In code

Secrets are read via `process.env` and never logged. The logger in
`packages/telemetry/src/logger.ts` redacts:

```ts
// Logger redacts anything matching these names
const REDACTED_FIELDS = new Set([
  "password", "secret", "token", "apikey", "api_key",
  "authorization", "jwt", "cookie", "session_id",
  "minimax_api_key", "openai_api_key", "anthropic_api_key",
]);
```

If you need to log a config object for debugging, use the `redact()`
helper:

```ts
import { redact } from "@max/telemetry";
log.debug({ config: redact(envConfig) }, "loaded config");
```

Never log a raw `process.env` dump.

---

## .gitignore

The repo's `.gitignore` MUST exclude:

- `.env`
- `.env.*` (except `.env.example`)
- `*.pem`, `*.key`
- `~/.kube/config` (not even adjacent)
- `coverage/` (often contains bearer tokens in trace dumps)

Verify with:

```bash
git check-ignore .env deploy/k8s/base/secret.yaml
```

---

## What to do when a secret leaks

1. **Contain** — revoke the leaked credential in the upstream system
   (rotate the Postgres password, invalidate the API key in the vendor
   dashboard, etc.).
2. **Rotate** — generate a new secret, update the K8s Secret (or trigger
   ESO sync), and verify the new secret is in use.
3. **Invalidate sessions** — for `JWT_SECRET`, force all users to
   re-authenticate by also rotating `JWT_REFRESH_SECRET` (existing
   refresh tokens will fail verify).
4. **Audit** — search logs for usage of the leaked value. Look for any
   request that used the secret's fingerprint.
5. **Postmortem** — fill in `docs/operations/post-mortem-template.md`
   with timeline, root cause, and remediation.
6. **Defense update** — add a row to `THREAT_MODEL.md` if the leak path
   was new.

---

## Out of scope (today)

- Vault dynamic secrets for short-lived DB credentials
- Hardware-backed key storage (HSM)
- Automatic secret scanning in CI (TODO: add `gitleaks` to `ci.yml`)

These are tracked in the platform backlog, not blockers for production
deployment today.