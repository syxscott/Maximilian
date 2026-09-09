# Backup & Restore — Maximilian PostgreSQL

This document covers the operational procedures for backing up and
restoring the PostgreSQL state that Maximilian depends on.

## What gets backed up

| Component | What | Why | Backup method |
|---|---|---|---|
| **PostgreSQL** | All schemas, including: users, workspaces, executions, metrics, evolution_events, org_events, telemetry, pending_proposals | Source of truth for everything | `pg_dump` |
| **Redis** (if `TASK_QUEUE_ENABLED=true`) | BullMQ job state — active / waiting / completed / failed | Required to resume in-flight tasks | `BGSAVE` + `COPY` |
| **Disk artifacts** | Workspace files, agent memory snapshots, execution logs | Filesystem-based fallback for many stores | `tar` snapshot |
| **Configuration** | `.env`, `config.json`, `docker-compose.yml`, K8s manifests | Reproducibility | Version control |

## Daily backup (recommended)

```bash
# PostgreSQL: full logical backup, compressed
pg_dump \
  --format=custom \
  --no-owner \
  --no-privileges \
  --jobs=4 \
  "$DATABASE_URL" \
  > backups/maximilian-$(date +%Y%m%d-%H%M).dump

# Encrypt + ship to object storage
gpg --symmetric --cipher-algo AES256 backups/maximilian-*.dump
aws s3 cp backups/maximilian-*.dump.gpg s3://maximilian-backups/postgres/
```

## Hourly incremental (optional, for large installs)

Use WAL archiving:

```sql
-- postgresql.conf
archive_mode = on
archive_command = 'aws s3 cp %p s3://maximilian-backups/wal/%f'
```

Combined with `pg_basebackup` taken daily, this gives point-in-time
recovery to within seconds.

## Restore procedure

### Full restore from logical dump

```bash
# 1. Stop the API + worker (so nothing writes during restore)
kubectl scale deploy/maximilian-api --replicas=0
kubectl scale deploy/maximilian-worker --replicas=0

# 2. Drop and recreate the database (CAUTION: destructive)
psql "$DATABASE_URL" -c "DROP DATABASE maximilian;"
psql "$DATABASE_URL" -c "CREATE DATABASE maximilian;"

# 3. Restore from dump
pg_restore \
  --dbname=maximilian \
  --no-owner \
  --no-privileges \
  --jobs=4 \
  backups/maximilian-20260706.dump

# 4. Re-run migrations (idempotent — safe to re-apply)
pnpm --filter @max/database migrate

# 5. Restart API + worker
kubectl scale deploy/maximilian-api --replicas=2
kubectl scale deploy/maximilian-worker --replicas=1
```

### Point-in-time recovery (PITR)

```bash
# 1. Stop the API + worker (as above)

# 2. Restore base backup
pg_basebackup --format=tar --target=backups/base

# 3. Configure recovery.conf / restore_command
echo "restore_command = 'aws s3 cp s3://maximilian-backups/wal/%f %p'" \
  >> postgres-config/postgresql.auto.conf

# 4. Specify recovery target
echo "recovery_target_time = '2026-07-06 14:30:00 UTC'" \
  >> postgres-config/postgresql.auto.conf
echo "recovery_target_action = 'promote'" \
  >> postgres-config/postgresql.auto.conf

# 5. Start PostgreSQL (enters recovery mode, then promotes)
systemctl start postgresql

# 6. Restart API + worker
```

## Verify backup integrity

After every backup, run a **dry restore** to a staging database:

```bash
# Restore to a separate DB
createdb maximilian_restore_test
pg_restore --dbname=maximilian_restore_test backups/maximilian-*.dump

# Smoke test critical queries
psql maximilian_restore_test -c "SELECT count(*) FROM workspaces;"
psql maximilian_restore_test -c "SELECT count(*) FROM executions;"
psql maximilian_restore_test -c "SELECT count(*) FROM users;"

# Drop test DB
dropdb maximilian_restore_test
```

Automate this in CI: `.github/workflows/backup-drill.yml` (weekly).

## Redis backup (if BullMQ enabled)

```bash
# Snapshot RDB
redis-cli BGSAVE
# Wait for completion
sleep 5
# Copy dump file
cp /var/lib/redis/dump.rdb backups/redis-$(date +%Y%m%d-%H%M).rdb
```

Restore: stop Redis, copy the dump file to `/var/lib/redis/dump.rdb`,
start Redis. In-flight jobs whose locks have expired will be picked up
again — BullMQ handles deduplication via job IDs.

## Disaster Recovery (DR)

Target Recovery Time Objective (RTO): **30 minutes**.
Target Recovery Point Objective (RPO): **1 hour** (hourly backups).

### DR runbook

1. **Detect** the outage via alerting (Prometheus / Grafana).
2. **Page** on-call via PagerDuty.
3. **Decide** between:
   - Local recovery (single region failure) → use backups above.
   - Region failover (full region failure) → spin up secondary region
     from latest replica + replay WAL.
4. **Verify** with smoke tests (see [runbook](runbook.md)).
5. **Communicate** status on the status page.

## What NOT to do

- ❌ Don't `rm -rf` the data directory as a "clean up".
- ❌ Don't take backups while a migration is running.
- ❌ Don't restore a backup to the live DB without first stopping writers.
- ❌ Don't assume the backup is good — always dry-restore first.
- ❌ Don't store backups on the same disk as the database.

## Monitoring

Set up alerts in Prometheus:

```yaml
- alert: BackupStale
  expr: time() - max(pg_backup_last_success_timestamp) > 86400
  for: 1h
  annotations:
    summary: "PostgreSQL backup hasn't succeeded in 24h"
```

```yaml
- alert: BackupSizeAnomaly
  expr: |
    abs(pg_backup_size_bytes - avg_over_time(pg_backup_size_bytes[7d])) >
    3 * stddev_over_time(pg_backup_size_bytes[7d])
  for: 1h
  annotations:
    summary: "Backup size deviates > 3σ from 7-day average"
```

## References

- PostgreSQL docs: https://www.postgresql.org/docs/current/backup.html
- BullMQ Redis persistence: https://docs.bullmq.io/guide/queues
- Maximilian deployment: [docs/operations/deployment.md](deployment.md)
- Runbook (incident response): [runbook.md](runbook.md)