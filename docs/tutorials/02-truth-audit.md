# Tutorial 02: TruthAudit — From Prediction to Verification

> **Length**: 8 minutes
> **Audience**: power users who want to know how Maximilian keeps itself honest
> **Goal**: explain what TruthAudit does and show it in action

## Pre-roll (10s)

VO: "How does Maximilian know its agents are actually improving?
Through TruthAudit — a continuous verification loop that compares
predictions against reality."

Visual: a question mark → a checkmark, animated.

## Shot 1 — The problem (45s)

VO: "When an agent says 'I expect this to work,' Maximilian takes that
seriously. It records the prediction. Then, when reality arrives, it
checks: was the prediction correct?"

Show a hypothetical:

```
Capability X predicted: "improves accuracy by 5%"
Reality after 100 runs: "accuracy unchanged, latency +12%"
```

VO: "Without verification, that's a hallucinated gain. With
TruthAudit, that's a calibration drift — and we can act on it."

## Shot 2 — How it works (90s)

Diagram (record the screen showing the architecture diagram from
[architecture/truth-audit-flow.md](../architecture/truth-audit-flow.md)):

```
Agent predicts ──► TruthAudit records
                      │
                      ▼
              (wait for reality)
                      │
                      ▼
              Verify: matches? ──► Calibration score updates
                      │
                      ▼
              Find drift ──► Alert / Retire proposal
```

VO: "Three steps. Record. Wait. Verify. The interesting part is the
'wait for reality' — it can be milliseconds for LLM checks, or weeks
for real-world task outcomes."

## Shot 3 — Live demo (3 min)

Open the dashboard, **Truth Audit** tab.

Step A — Make a prediction:

```bash
curl -X POST http://localhost:3000/v1/meta-system/proposals \
  -H 'Content-Type: application/json' \
  -d '{
    "type": "promote",
    "capabilityId": "summarizer-v3",
    "predictedImprovement": "+8% accuracy"
  }'
```

VO: "We're proposing to promote summarizer-v3 with a predicted +8%
accuracy improvement."

Show the proposal in the dashboard — note `truthMeasurementId`
attached.

Step B — Run the agent 100 times:

```bash
for i in {1..100}; do
  curl -X POST http://localhost:3000/v1/executions \
    -d '{"workspaceId":"eval","input":"summarize this..."}'
done
```

VO: "Now we run the agent 100 times to get a real signal."

Step C — Trigger verification:

```bash
curl -X POST http://localhost:3000/v1/meta-system/truth-verify \
  -d '{"proposalId":"prop_abc123"}'
```

Show the report:

```json
{
  "proposalId": "prop_abc123",
  "predicted": 0.08,
  "measured": 0.031,
  "calibrationError": 0.049,
  "verdict": "over-confident",
  "samples": 100
}
```

VO: "Predicted 8%, actual 3%. The agent was over-confident. Calibration
error: 4.9 percentage points. This is exactly what TruthAudit is for."

## Shot 4 — Drift detection (90s)

VO: "If a capability is consistently over- or under-confident,
TruthAudit flags it for retirement."

Show dashboard:

- Calibration score for summarizer-v3 dropping week-over-week.
- Alert: "summarizer-v3 calibration drift > 5σ".
- A retire proposal auto-generated.

VO: "The meta-system now has evidence, not vibes. It can act."

## Shot 5 — Configuration (30s)

Show `.env`:

```
TRUTH_AUDIT_ENABLED=true
TRUTH_AUDIT_MIN_SAMPLES=3      # min samples before verification
TRUTH_AUDIT_DRIFT_THRESHOLD=3  # σ for drift alert
```

VO: "Three knobs. Enable, minimum sample size, drift threshold.
Defaults are sane."

## Shot 6 — Wrap-up (15s)

VO: "Predictions are cheap. Reality is what matters. TruthAudit keeps
Maximilian honest. Next: self-evolution in detail."

## Recording checklist

- [ ] Pre-seed TruthAudit with some data (so dashboard isn't empty).
- [ ] Run the eval loop BEFORE recording (not live).
- [ ] Use a script with `sleep 1` between curls so the terminal output
      is readable.
- [ ] Make sure the truth-verify API endpoint exists in your build.

## Post-production

- Use callouts / zoom-ins on the JSON output.
- Animate the calibration drift chart.
- Add inline captions for "predicted" vs "measured" numbers.