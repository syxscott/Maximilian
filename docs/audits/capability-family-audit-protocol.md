# Capability-Family Audit Protocol

How a self-evolution capability family earns the right to ship — and what
happens while it has not. Methodology borrowed from codebase-memory-mcp's
document-family ship gate (commits `7209ae12` / `78eace4f`), adapted to the
artifact families of the evolution engine.

## What a family is

One row of `CAPABILITY_FAMILIES` in `packages/evolution/src/ship-gates.ts`.
The single tuple generates both the family's name (the derived
`CapabilityFamily` union) and its gate (the derived `FAMILY_SHIP_GATES`
map), so a family cannot exist without a name and a gate — the TypeScript
counterpart of the C X-macro list that generates an enum and its table from
one row set.

Current families: `prompt_rewrite`, `memory_curation`, `lesson_gating`,
`model_selection`, `background_reflection` (shipped); `oracle_triad` (held:
audit scored 93/100 — point estimate below the bar); `team_rebalance`
(held: never audited — no held-out occurrences to sample yet).

## The bar

A family ships when a held-out audit shows that its artifact is correct
often enough:

- **Wilson 95% lower bound >= 0.90**, and
- **point estimate >= 0.95**,

on a sample of at least 30 held-out occurrences (practical convention: 150,
or the full census when the population is smaller). Both conditions must
hold. The Wilson lower bound is the discipline: 79/79 passes (lower bound
0.954) while 93/100 fails (point 0.93 is below the bar regardless of the
bound).

## Held-out sampling

- The sample comes from repositories, workspaces or corpora **disjoint
  from every corpus used to build or tune the family's implementation**.
  A family tuned on the data it is judged on has no audit.
- Sample by an objective rule stated before judging (for example: every
  k-th artifact produced in the audit window), and record the rule in the
  ledger entry's PR description.
- When the population is smaller than the target sample, judge the whole
  population (census) and record `judged` as the population size.

## Blind judging

- The judge reads the artifact against its source (the task, the metrics,
  the memory it was derived from) and decides correctness **without seeing
  the family's verdict history, its code path, or the gate state**.
- Every artifact not judged correct — and a seeded tenth of the rest —
  gets a **second reader**. Record the agreement rate in the audit PR; a
  disagreement is resolved by the source, not by discussion.
- An artifact counts as correct only when it does what it claims on its
  own evidence (the prompt-rewrite candidate actually addresses the
  observed failure modes; the curated lesson states a rule, not an
  incident).

## Failing the bar

A family below the bar (or never audited) is **held, not disabled**:

- the family keeps producing artifacts exactly as before,
- every row carrying its artifact is marked degraded —
  `degradation.code = "below_bar_tier"` with a reason naming the family
  and the bar — through `resolveFamilyRow` (the evolution engine stamps
  every `EvolutionDecision` with its `prompt_rewrite` gate state),
- what is withheld is only the _promotion to shipped status_; nothing
  about production behaviour changes.

## The ledger and the test

Audit records live in
`packages/evolution/test/fixtures/ship-gate-audit-ledger.json` — one row
per audit: family, verdict, judged, correct, date. The ledger keeps failed
audits too: they are the history that explains why a family is held.

`shipGateViolations` (run by `packages/evolution/test/ship-gates.test.ts`)
fails when:

- a family marked `ships: true` in the registry has no passing audit in
  the ledger (**re-opening a held family turns the test red**), or
- its latest audit misses the bar or the minimum sample, or
- the ledger names a family the registry does not define.

To ship a family: run the held-out audit, add the record to the ledger,
flip the registry row to `true` in the same change — the test guards that
both halves landed together.

## Scoring an audit: worked example

From the reference audit (codebase-memory-mcp `78eace4f`): a tier with a
population of 5,980 samples 150 links blind; 150/150 correct gives Wilson
95% lower bound 0.975 — ships. A tier with 650 population and 79
occurrences is judged as a census; 79/79 gives 0.954 — ships, barely. A
tier scoring 93/100 has point estimate 0.93 (< 0.95) — held, whatever the
bound says.
