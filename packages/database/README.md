# @max/database

PostgreSQL schema and store implementations for Maximilian. Uses Drizzle ORM
for type-safe queries and Drizzle Kit for migrations.

## Setup

```bash
# 1. Set the database URL
export DATABASE_URL="postgresql://user:pass@localhost:5432/maximilian"
# Or create a .env file in the package root:
echo 'DATABASE_URL=postgresql://user:pass@localhost:5432/maximilian' > .env

# 2. Apply migrations
pnpm db:migrate

# 3. (Dev only) Push schema directly without migrations
pnpm db:push
```

## Workflow

| Command | When to use |
|---------|------------|
| `pnpm db:generate` | After editing `src/schema.ts` — creates a new migration file in `drizzle/` |
| `pnpm db:migrate`  | Apply pending migrations to the configured database |
| `pnpm db:push`     | Dev only — sync schema directly, skipping migration files |
| `pnpm db:studio`   | Open Drizzle Studio to browse data |
| `pnpm db:drop`     | Drop the database (DESTRUCTIVE — only for dev reset) |

## Layout

```
src/
  schema.ts        # Drizzle table definitions (one source of truth)
  index.ts         # createDb(), closeDb(), all Pg* store exports
  tenant-guard.ts  # Multi-tenant access control helpers
  stores/
    pg-workspace-store.ts
    pg-metrics-store.ts
    ...
drizzle/           # Generated migration files (commit these!)
drizzle.config.ts  # Drizzle Kit config
```

## Production Deployment

The migration system uses a `__drizzle_migrations` tracking table. To apply
migrations in a Docker entrypoint:

```dockerfile
CMD ["sh", "-c", "pnpm --filter @max/database db:migrate && pnpm --filter @max/api start"]
```

Or run as a one-shot Job in Kubernetes:

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: db-migrate
spec:
  template:
    spec:
      containers:
        - name: migrate
          image: maximilian-api:latest
          command: ["pnpm", "--filter", "@max/database", "db:migrate"]
          envFrom:
            - secretRef: { name: db-credentials }
      restartPolicy: OnFailure
```

## Multi-Tenancy

All tenant-scoped tables have a nullable `tenant_id` column. The `tenant-guard.ts`
module provides:

- `validateTenantId(id)` — sanity-check a tenant id
- `scoped(id, source)` — build a frozen tenant context
- `assertSameTenant(a, b)` — refuse cross-tenant access
- `sanitizeFilter(filter, ctx)` — reject filters that override the tenant

Store methods accept an optional `tenantId?: string` argument. When provided,
queries are filtered by tenant. When omitted, no tenant filter is applied
(backward-compatible single-tenant mode).
