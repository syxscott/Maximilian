# RFCs (Requests for Comments)

Non-trivial changes to Maximilian go through this RFC process before
implementation. The goal is to align on design *before* code is written,
saving review time and avoiding wasted work.

## When to write an RFC

| Definitely | Maybe | No (just PR) |
|---|---|---|
| New public API surface | Significant internal refactor | Bug fix |
| Breaking change to a stable API | Cross-cutting concern | Single-file change |
| New external dependency | Deprecating an existing API | Doc-only update |
| Architecture change | Adding a new env var that customers use | Test-only change |
| Anything affecting governance / HITL | Performance optimization | |

When in doubt: write the RFC. They take ~30 min and save hours later.

## Process

1. **Author** opens an issue with the **RFC** template
   (`.github/ISSUE_TEMPLATE/rfc.md`).
2. **Author** writes the RFC doc by copying
   [`template.md`](template.md) to `docs/rfcs/NNN-short-name.md`,
   filling in every section.
3. **Discussion** lasts **at least 5 business days**. Anyone can comment.
4. **Decision** at the end:
   - ✅ **Accepted** → create tracking issue, link to RFC, start work.
   - 🔄 **Revise** → author updates RFC, restarts the clock.
   - ❌ **Rejected** → close with rationale, link archived.
5. **Implementation** happens in PRs that reference the RFC. Major
   divergence from the RFC during implementation requires either an
   amendment (link in the RFC) or a new RFC.

## Status legend

In the RFC front-matter:

- `Status: draft` — author is still writing.
- `Status: review` — open for community comment.
- `Status: accepted` — approved, implementation pending.
- `Status: implementing` — PRs in flight.
- `Status: shipped` — fully released, RFC archived.
- `Status: rejected` — not accepted, kept for the historical record.

## Active RFCs

| # | Title | Status | Owner |
|---|---|---|---|
| 0001 | Truth Audit persistence model | accepted | @syxscott |
| 0002 | Webhook / SSE event subscriptions | accepted | @syxscott |
| 0003 | Feature Flag SDK for customers | accepted | @syxscott |

## Archived RFCs

| # | Title | Outcome | Closed |
|---|---|---|---|
| (none yet) | | | |

## See also

- [template.md](template.md) — RFC doc template
- [DEPRECATION.md](../DEPRECATION.md) — how we mark APIs deprecated
- [docs/decisions/](../decisions/) — shorter ADRs for smaller decisions
  (no community review required)