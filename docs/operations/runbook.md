# Runbook — Maximilian Operations

> **Audience:** on-call engineers responding to incidents.
> **Goal:** resolve or mitigate within 30 minutes; capture learnings via
> post-mortem (template: [post-mortem-template.md](post-mortem-template.md)).

## Severity definitions

| Sev | Definition | Examples | Response time |
|---|---|---|---|
| **SEV-1** | Production down or data-loss risk | DB unreachable; Redis dead; auth broken | Page immediately, 24/7 |
| **SEV-2** | Major feature degraded | LLM calls failing for > 30% requests; meta-system loop halted | Page in business hours |
| **SEV-3** | Minor issue, workaround exists | Dashboard component broken; doc typo | Next business day |
| **SEV-4** | Cosmetic / non-urgent | i18n string missing | Backlog |

## On-call rotation

- **Primary**: see PagerDuty schedule (`.pd.yaml` not in repo).
- **Backup**: 1 person, same team.
- **Escalation**: tech lead → engineering manager → CTO.

## Alert sources

| Source | Type | Alert manager |
|---|---|---|
| Prometheus | Latency / error rate / saturation | Alertmanager → Slack + PagerDuty |
| Pino logs (level ≥ error) | Application errors | Loki → Slack |
| Health endpoint `/healthz` | Service liveness | k8s liveness probe |
| Readiness `/readyz` | Service readiness | k8s readiness probe |

## Common incidents

### INC-001: PostgreSQL unreachable

**Symptoms**: API returns 500 on all writes; `probePostgres` in `/readyz`
fails; error rate spike on `/v1/workspaces`.

**Diagnosis**:
```bash
# Check connection
psql "$DATABASE_URL" -c "SELECT 1;"

# Check pod status (k8s)
kubectl get pods -n maximilian -l app=postgres

# Check logs
kubectl logs -n maximilian -l app=postgres --tail=200
```

**Mitigation**:
1. If k8s pod crashed → check `kubectl describe pod` for OOM/restart count.
   Restart: `kubectl rollout restart sts/postgres`.
2. If connection string wrong → `kubectl get secret maximilian-pg -o yaml`
   verify, redeploy API.
3. If PostgreSQL is genuinely down → see [backup-restore.md](backup-restore.md)
   for restore procedure. This is SEV-1 — page backup + tech lead.

### INC-002: LLM provider rate-limited

**Symptoms**: spike in 429 from upstream; circuit-breaker opens;
`taskFailedReason=rate_limited` in logs.

**Diagnosis**:
```bash
# Check circuit-breaker state
curl http://api:3000/metrics | grep circuit_breaker_state

# Check upstream status (anthropic.com / openai.com status pages)
```

**Mitigation**:
1. Circuit-breaker should auto-failover to secondary provider
   (configured in `config/providers.json`).
2. If no secondary: reduce concurrency (`LLM_CONCURRENCY=2` env var),
   restart API.
3. Consider throttling user-facing requests at the gateway level.

### INC-003: BullMQ worker stuck

**Symptoms**: tasks pile up in `waiting` state; `stuck` jobs in BullMQ
dashboard; `/healthz/queue` returns `degraded`.

**Diagnosis**:
```bash
# BullMQ dashboard (if enabled)
open http://admin:3001

# Manual inspect
redis-cli -u "$REDIS_URL" ZRANGE bull:workspaces:waiting 0 -1 WITHSCORES
```

**Mitigation**:
1. Restart worker: `kubectl rollout restart deploy/maximilian-worker`.
2. If a single job is stuck: `redis-cli ZREM bull:workspaces:stuck <jobId>`.
3. If worker keeps OOMing: lower `WORKER_CONCURRENCY` env var.

### INC-004: Meta-system loop runaway

**Symptoms**: org-evolution events spiking; capabilities being birthed
without governance review; TruthAudit drift alarms firing.

**Diagnosis**:
```bash
# Check orchestrator logs
kubectl logs -n maximilian -l app=api --tail=500 | grep orchestrator

# Check truth audit report
curl http://api:3000/v1/meta-system/truth-report
```

**Mitigation**:
1. **Stop the loop**: set `META_AGENT_ENABLED=false` env var, restart API.
2. Review the most recent `ProposalPipeline` decisions in
   `org_events` table.
3. If a wrong proposal was applied: use the **retire** manual endpoint
   to roll back, or apply a corrective `birth` proposal.

### INC-005: Memory leak / OOM

**Symptoms**: pod memory climbs monotonically over hours/days; eventually
OOMKilled; restarts.

**Diagnosis**:
```bash
# Heap snapshot (Node.js)
kubectl exec -it api-pod -- node --inspect=0.0.0.0:9229 dist/index.js
# Connect Chrome devtools to :9229, take heap snapshot
```

**Mitigation**:
1. Bump memory limit (temporary): `kubectl set resources deploy/api
   --limits=memory=2Gi`.
2. Find the leak: usually a forgotten ring buffer or unclosed handle.
3. Roll out a fix or add a periodic restart (cron + SIGHUP-friendly).

### INC-006: Region failover (multi-region deployments)

**Symptoms**: A region's pods are unhealthy; `kubectl get nodes -n
maximilian --context=<region>` shows not-ready nodes; the regional
ingress is returning 5xx.

**Diagnosis**:
```bash
# Confirm regional failure (vs single-pod)
kubectl get pods -n maximilian --context=<region> -o wide
kubectl get nodes -n maximilian --context=<region>

# Confirm peer region is healthy
kubectl get pods -n maximilian --context=<peer-region> -o wide
```

**Mitigation**:
1. If single-pod failure → use `kubectl rollout restart` per
   [INC-005](#inc-005-pod-oomkilled).
2. If regional failure (network partition, cloud provider outage):
   a. Update the regional DNS / global load balancer to send traffic
      to the peer region only.
   b. If using Aurora Global / Spanner, writes automatically fail
      over to the peer primary within ~30s.
   c. BullMQ jobs that were enqueued in the dead region need to be
      re-enqueued against the peer. Run:
      ```bash
      # From your local machine with both contexts available
      kubectl --context=<peer-region> exec -it deploy/worker -- \
        node -e "require('./dist/queue/requeue-orphans.js') --from-region=<dead-region>"
      ```
   d. Page backup + tech lead (this is SEV-1 if impact > 30 min).
3. Document the failover in the incident log. Use the post-mortem
   template. Note whether the failover met the [RTO/RPO
   targets](../operations/multi-region.md#rto--rpo-targets).

### INC-007: opencode serve crash loop

**Symptoms**: Worker pods are crash-looping; logs show `ECONNREFUSED
127.0.0.1:4096`; the meta-cycle stalls waiting for the opencode
executor to return.

**Diagnosis**:
```bash
kubectl logs -n maximilian -l app=worker --tail=200 | grep -i opencode
kubectl get pods -n maximilian -l app=opencode-serve
```

**Mitigation**:
1. If opencode-serve is the bundled sidecar (`apps/worker/cmd/opencode-serve`),
   it's restarted by the worker process supervisor — just wait one
   restart cycle (~30s).
2. If it's a separate Deployment, restart it:
   `kubectl rollout restart deploy/opencode-serve -n maximilian`.
3. If it keeps crashing, page backup (Phase 1's TruthAudit depends on
   this; the meta-cycle will halt without it).

### INC-008: TruthAudit data corruption / drift

**Symptoms**: `truthAuditVerdictsTotal{verdict="accurate"} / total`
drops below the SLO-3 threshold (80%); the recalibration dashboard
shows sustained drift.

**Diagnosis**:
```bash
# Inspect recent TruthReports via the admin API
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$API_URL/api/admin/truth-audit/reports?limit=10"

# Or via psql directly
psql "$DATABASE_URL" -c "
  SELECT proposal_id, verdict, recorded_at
  FROM truth_verifications
  ORDER BY recorded_at DESC
  LIMIT 50;
"
```

**Mitigation**:
1. If a single proposal is producing bad verdicts, mark it as
   `retired` so the meta-cycle doesn't use it as a model:
   ```sql
   UPDATE proposals SET status = 'retired', reason = 'truth-audit-drift'
     WHERE id = '<id>';
   ```
2. If calibration drift is sustained across proposals, lower the
   `TRUTH_AUDIT_CONFIG.tolerance` temporarily to be more strict:
   `kubectl set env deploy/api TRUTH_AUDIT_TOLERANCE=0.05` (was 0.10).
3. If a TruthMeasurement batch was bad (e.g. wrong predicted vs actual
   input), purge it:
   ```bash
   psql "$DATABASE_URL" -c "
     DELETE FROM truth_measurements
     WHERE recorded_at > now() - interval '1 hour'
       AND proposal_id IN ('<id1>', '<id2>');
   "
   ```
   The next cycle will rebuild calibration from the remaining
   samples.
4. Document in the post-mortem template. If drift is a model-quality
   issue, file a ticket against the prompt-engineering backlog.

### INC-009: Secret rotation urgent (key compromise)

**Symptoms**: Confirmed leak of a secret (env file committed, K8s
Secret logged, ex-employee access).

**Mitigation** (steps from [SECRETS.md](../../security/SECRETS.md)
**"What to do when a secret leaks"**):
1. Revoke the leaked credential in the upstream system (rotate the
   Postgres password, invalidate the API key in the vendor dashboard,
   etc.).
2. Generate a new secret and update the K8s Secret (or trigger ESO
   sync).
3. For `JWT_SECRET`, force all users to re-authenticate by also
   rotating `JWT_REFRESH_SECRET`.
4. Search logs for usage of the leaked value (fingerprint match).
5. Post-mortem using [post-mortem-template.md](post-mortem-template.md).
6. Add a row to [THREAT_MODEL.md](../../security/THREAT_MODEL.md) for
   the leak path if new.

## Communication

- **SEV-1**: status page update within 5 min; internal Slack
  `#incidents` channel; customer email if impact > 30 min.
- **SEV-2**: status page update within 30 min.
- **SEV-3/4**: backlog, no comms.

## Post-incident

Within 48 hours of any SEV-1 or SEV-2:
1. Open a post-mortem doc using [post-mortem-template.md](post-mortem-template.md).
2. Schedule a blameless review meeting (60 min).
3. Track action items to closure in the issue tracker.

## Useful dashboards

| Name | URL | Use |
|---|---|---|
| API Latency | grafana.internal/d/api-latency | p50/p95/p99 per route |
| Error Rate | grafana.internal/d/error-rate | 4xx/5xx per route |
| LLM Spend | grafana.internal/d/llm-spend | USD per provider/model |
| Queue Depth | grafana.internal/d/queue-depth | BullMQ waiting/active |
| Truth Audit | grafana.internal/d/truth-audit | Calibration drift |
| DB Pool | grafana.internal/d/db-pool | Connection pool saturation |

## References

- [deployment.md](deployment.md) — how to deploy
- [backup-restore.md](backup-restore.md) — how to recover data
- [post-mortem-template.md](post-mortem-template.md) — incident write-up
- [SECURITY.md](../../SECURITY.md) — vulnerability disclosure (separate channel)