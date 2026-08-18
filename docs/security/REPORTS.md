# Security Reports

**Owner**: Platform team
**Effective from**: 2026-08-18 (Phase 10)

This document is the public-facing entry point for security disclosures.
It points to the policy, the disclosure email, and the bug-bounty scope
(when applicable).

---

## Reporting a vulnerability

Email: **security@maximilian.local** (PGP key on request)

Please **DO NOT** file security issues on the public issue tracker. We
treat all inbound reports as confidential until a fix is shipped.

What to include:

1. Vulnerability description (what's the threat?)
2. Reproduction steps (how do we trigger it?)
3. Impact assessment (what can an attacker do?)
4. Suggested fix (if you have one)
5. Your name / handle for the hall of fame (optional)

---

## Response targets

| Stage | Target |
| ----- | ------ |
| Initial acknowledgement | 2 business days |
| Triage + severity assessment | 5 business days |
| Patch shipped for High/Critical | 30 days |
| Patch shipped for Medium | 90 days |
| Public disclosure | After patch is in production + 30 days |

These targets assume the report is reproducible and the threat is real.
Social-engineering and physical-access reports are acknowledged but not
subject to the patch timeline.

---

## Severity scale

We use CVSS 3.1 as the baseline. Internal classification:

| Severity | CVSS | Example |
| -------- | ---- | ------- |
| Critical | 9.0-10.0 | Auth bypass without credentials |
| High | 7.0-8.9 | Cross-tenant data access |
| Medium | 4.0-6.9 | Limited info disclosure |
| Low | 0.1-3.9 | Defense-in-depth gap with no known exploit |

---

## Hall of fame

Researchers who reported a vulnerability fixed in production:

- _none yet_

---

## Audits

| Date | Scope | Auditor | Report |
| ---- | ----- | ------- | ------ |
| 2026-08-18 (Phase 10) | Internal — STRIDE threat model + tenant-guard + permission translator | Platform team | `THREAT_MODEL.md` |
| _future_ | Pre-publish external review | TBD | TBD |

---

## Related docs

- [`THREAT_MODEL.md`](./THREAT_MODEL.md) — what we defend against and how
- [`../operations/runbook.md`](../operations/runbook.md) — what to do when
  an incident is in progress
- [`../operations/post-mortem-template.md`](../operations/post-mortem-template.md) —
  post-incident writeup format