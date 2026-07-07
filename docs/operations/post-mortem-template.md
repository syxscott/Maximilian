# Post-Mortem: <incident title>

> Copy this template to a new file under `docs/operations/post-mortems/`
> within 48 hours of any SEV-1 or SEV-2 incident. Fill in every section.
> This is a **blameless** document — focus on systems, not individuals.

## Metadata

- **Incident ID**: INC-YYYY-NNN
- **Severity**: SEV-1 / SEV-2 / SEV-3
- **Date detected**: YYYY-MM-DD HH:MM UTC
- **Date resolved**: YYYY-MM-DD HH:MM UTC
- **Duration**: HH:MM
- **Detection source**: alerting / customer report / on-call noticing
- **On-call responder**:
- **Incident commander**:
- **Communication lead**:
- **Reviewers** (assigned at end of doc):

## Summary

<!-- 1-2 sentences. What broke, who was affected, how long. -->

## Impact

- **Customer-visible**: <describe>
- **Internal**: <describe>
- **Data loss**: yes / no — <details>
- **SLO impact**: <which SLO was violated, by how much>

## Timeline (UTC)

| Time | Event |
|---|---|
| HH:MM | First anomaly in metrics (retrospective) |
| HH:MM | Alert fired |
| HH:MM | On-call paged |
| HH:MM | Investigation began |
| HH:MM | Mitigation applied |
| HH:MM | Service fully restored |

## Root cause

<!-- Be specific. What exact failure mode? Trace from symptom → mechanism →
   underlying condition. -->

### Contributing factors

- <!-- Pre-existing conditions that made the failure worse or harder to recover from. -->

### What went well

- <!-- Things that worked: alerting, runbooks, communication, etc. -->

### What went poorly

- <!-- Gaps in detection, response, tools, etc. -->

## Trigger

<!-- What initiated the incident. A deploy, traffic spike, config change, etc. -->

## Resolution

<!-- Step-by-step what was done to mitigate and resolve. -->

## Action items

| Action | Owner | Priority | Due |
|---|---|---|---|
| Add missing metric / alert | @name | P0 | YYYY-MM-DD |
| Improve runbook section X | @name | P1 | YYYY-MM-DD |
| Refactor fragile component Y | @name | P2 | YYYY-MM-DD |

## Lessons learned

<!-- 3-5 bullet points. What's the takeaway? -->

## Detection improvements

<!-- Could we have detected this earlier? Faster? More accurately? -->

## Recovery improvements

<!-- Could we have recovered faster? What's the bottleneck? -->

## Prevention

<!-- How do we prevent this class of incident from happening again? -->

## Related

- Slack channel: #inc-YYYY-NNN
- Dashboard: <link>
- Customer comms: <link>
- Follow-up issues: <list>

---

> **Blameless reminder**: assume everyone involved was acting in good
> faith with the information they had. Focus on what the system allowed
> them to do, not on what they did or didn't do.