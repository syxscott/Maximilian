# Multi-Region Deployment

**Owner**: Platform team
**Effective from**: 2026-08-18 (Phase 11)
**Review cadence**: Quarterly

This document describes the architecture for running Maximilian across
multiple cloud regions. It is intentionally prescriptive about which
components are regional vs global, so the failure modes stay simple.

## Goals

1. **Survive a single-region cloud-provider outage.** Customers in the
   affected region should be able to read (within minutes) and write
   (within tens of seconds) against a peer region.
2. **Keep the data model simple.** One logical database, even if it's
   replicated across regions. No sharding, no per-region tables.
3. **Don't break the opencode serve integration.** Each region runs
   its own opencode instance; the kernel migration (Phase 4) is
   already per-region-friendly because the executor takes a
   `baseUrl` config.

## Architecture

```
                    ┌─────────────────────────────────────┐
                    │      Global Layer (managed)         │
                    │  - DNS / global LB (Route 53 / GCP) │
                    │  - Multi-region Postgres (Aurora    │
                    │    Global / Spanner / CockroachDB)  │
                    │  - Cross-region S3 (artifacts)      │
                    └─────────────────────────────────────┘
                          │                │
              ┌───────────┘                └───────────┐
              ▼                                        ▼
    ┌──────────────────┐                    ┌──────────────────┐
    │  Region: us-east-1│                   │  Region: eu-west-1│
    │  - API (3 pods)   │                   │  - API (3 pods)   │
    │  - Worker (3 pods)│                   │  - Worker (3 pods)│
    │  - Dashboard (2)  │                   │  - Dashboard (2)  │
    │  - opencode serve │                   │  - opencode serve │
    │  - Redis (region) │                   │  - Redis (region) │
    └──────────────────┘                    └──────────────────┘
```

## Per-region vs global

| Component | Scope | Why |
| --------- | ----- | --- |
| Postgres | Global (managed multi-region) | Customer data is one logical DB |
| Redis (BullMQ) | Per-region | Jobs are tagged with origin region; failover re-enqueues to peer |
| opencode serve | Per-region | Local LLM call latency matters; sessions are per-region |
| API / Worker / Dashboard | Per-region | Stateless; behind a global LB |
| Secrets | Global (AWS Secrets Manager) | Mirrored to each region's K8s Secret via ESO |
| OTel / Honeycomb | Global | One workspace, multiple datasets (one per region) |
| TruthAudit data | Global (in Postgres) | Calibration is global — local drift is the same signal everywhere |

## RTO / RPO targets

| Tier | Target | Why |
| ---- | ------ | --- |
| RTO (Recovery Time Objective) | 5 min for read traffic, 60s for write traffic | DNS failover is automatic via Route 53 health checks |
| RPO (Recovery Point Objective) | 30s for writes | Aurora Global replication lag < 1s in practice; budget allows for re-promotion latency |

If your cloud provider can't meet these, the multi-region overlay is
not for you — fall back to a single-region deployment + offline
backups.

## Failover flow

1. **Detection**: Global LB (Route 53 / GCP) notices the regional
   health check failing. Health check is `GET /readyz` on the regional
   API pod.
2. **Traffic shift**: DNS records update within ~30s to send all
   new traffic to the peer region.
3. **Postgres**: Aurora Global automatically promotes the regional
   read replica within ~30s. Application reconnects via the new
   endpoint URL (the cluster's writer endpoint stays the same from
   the application's perspective).
4. **Redis**: New writes go to the peer region. Jobs that were
   in-flight in the dead region are re-enqueued against the peer via
   `scripts/requeue-orphans.ts`.
5. **opencode**: opencode sessions that were running in the dead
   region are abandoned (the `OpencodeExecutor.shutdown()` doesn't
   get called). The leak metric
   (`opencodeSessionsLeakedTotal`) will spike; that's expected and
   the SLO budget accommodates a single failover per quarter.
6. **Operator action**: page on-call to confirm failover, then file
   a post-mortem using the standard template.

## Deploying the overlay

```bash
# For each region, apply the multi-region overlay against that
# cluster's kubeconfig context.
kubectl apply -k deploy/k8s/overlays/multi-region --context=us-east-1
kubectl apply -k deploy/k8s/overlays/multi-region --context=eu-west-1
```

After applying, verify:

```bash
# Each region's pods should have the region label set
kubectl get pods -n maximilian --context=us-east-1 -L region
kubectl get pods -n maximilian --context=eu-west-1 -L region

# The DEPLOY_REGION env should match the cluster's region
kubectl exec -n maximilian --context=us-east-1 deploy/api -- \
  printenv DEPLOY_REGION
```

## What this overlay does NOT solve

- **Active-active writes with low latency.** The overlay assumes
  one logical DB with one primary at a time. If you need
  active-active, use Spanner or CockroachDB (both supported via
  DATABASE_URL swap) but expect to re-tune the TruthAudit's
  `MIN_SAMPLE_SIZE` because calibration latency increases with
  cross-region replication lag.
- **Data residency compliance.** If GDPR / data-residency requires
  EU data to never leave EU, this overlay is not enough — you'll
  need a separate logical DB per region and a tenant-routing layer.
- **Cost.** Two regions × 3 API + 3 worker + 2 dashboard = 16 pods
  minimum, plus the multi-region Postgres markup. Don't deploy this
  if you're not ready for ~2.2× the single-region cost.

## Testing failover

Quarterly DR drill:

1. Pick a non-production cluster with the multi-region overlay
   applied.
2. Block egress from one region's API pods to Postgres (`kubectl
   exec` + `iptables`).
3. Confirm the global LB shifts traffic within 60s.
4. Confirm writes succeed against the peer region's DB.
5. Run `scripts/requeue-orphans.ts --from-region=<dead>` and verify
   BullMQ drains.
6. Restore egress.
7. File the drill in the incident log under tag `dr-drill`.

## Related docs

- [`runbook.md`](runbook.md#inc-006-region-failover-multi-region-deployments) —
  INC-006 step-by-step
- [`backup-restore.md`](backup-restore.md) — last-resort DB restore
  (only needed if both regions are lost)
- [`../security/SECRETS.md`](../security/SECRETS.md) — per-region secret
  propagation via ESO
- [`../security/THREAT_MODEL.md`](../security/THREAT_MODEL.md) — cross-region
  threats (DDoS on global LB, replication lag exploitation)