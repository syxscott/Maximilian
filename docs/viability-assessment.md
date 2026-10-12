# Viability Assessment — evaluation prompt template

(Kosmos `70799e4`/`73f4d2a` borrowing: the prompt skeleton for judging whether
a repository, subsystem, or self-evolution candidate is worth continued
investment, plus the binding owner-decision record format. Adapted for
Maximilian's evolution/meta-system evaluation surfaces.)

## The prompt skeleton

When asked "is X viable / worth continuing", the assessor MUST produce a
report with the following sections, in order:

### 1. Intent (write this FIRST, before reading the defect list)

Restate what X is _for_ — the purpose it is judged against, not the bugs it
has. Every later verdict anchors back to this statement.

### 2. Verified facts

Each fact carries `file:line` and must be re-read immediately before being
cited. Facts not re-read are marked "unverified" and cannot support a
verdict.

### 3. Viability criteria (explicit, before evidence)

A finding counts toward viability only if it:

- comes from code that was actually executed during assessment,
- reports statistics that are internally consistent,
- is reproducible (a second run produces the same claim),
- passes the project's verification gates,
- reports failures and costs honestly (absence of failure claims is not
  evidence of success).

### 4. End-to-end replay

Replay one real run end-to-end and mark **where the real work stops** — the
exact hop at which behavior degenerates into scaffolding, mocks, or
fabrication.

### 5. Findings: structural vs fundamental

- **Structural** — wrong wiring, missing integration, fixable by an
  engineering change.
- **Fundamental** — a design or capability limit that no amount of wiring
  fixes.

Every finding is classified; "unknown" is not allowed — investigate until
the classification is made.

### 6. Verdict (exactly one)

`VIABLE` | `CONDITIONALLY VIABLE` | `RESEARCH ONLY` — with 3–5 primary
reasons tied to §5 findings. No other verdict values are permitted.

### 7. Change plan (P0–P3)

Each item: ID, acceptance test, dependencies, blast radius, effort estimate.
Every step must leave the test suite no worse than before.

`RESEARCH ONLY` verdicts additionally carry a **salvage list**: components
worth keeping if the effort is wound down.

### 8. Output quality metrics

Defined as "emitted at which point in the code" — each metric names the
exact emission site that produces it, so the numbers are auditable.

### 9. Appendices

- **Evidence index** — every `file:line` cited, in one list.
- **Assumptions** — everything the assessment took on faith.

## Binding owner decisions (record format)

Owner decisions that shape a plan are recorded INLINE in the plan body,
never in a separate decisions file that drifts:

```
- DECISION (owner, 2026-10-13, BINDING): keep Tier C evaluator.
  Rationale: <one line>. Folded into: P2-3.
```

Rules:

1. Every decision carries a date and the `BINDING` marker.
2. Decisions are folded into the plan text they affect — the plan reads
   correctly without consulting a separate log.
3. The plan header declares: "all decisions folded in; steps apply
   independently in order; when line numbers drift, locate by citation."
4. Superseded decisions stay in the text struck through, not deleted —
   the history of what was decided when is part of the record.
