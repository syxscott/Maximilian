# Deployment

Two paths:

- **`docker-compose.yml`** — single-host self-hosted, the simplest path.
- **`deploy/k8s/`** — Kubernetes manifests for production-grade deployments.

## Docker Compose

```bash
# 1. Configure environment
cp .env.example .env
# Edit .env to add real API keys (OPENAI_API_KEY, etc.).

# 2. Bring up the stack
docker compose up -d          # API + dashboard + postgres
docker compose --profile queue up -d   # add Redis + worker

# 3. Verify
bash scripts/smoke-test.sh

# 4. (optional) bring up observability
docker compose --profile observability up -d   # Prometheus + OTel collector
```

The dashboard is at http://localhost:5173 and the API at
http://localhost:3001. `/api/docs` shows Swagger UI generated from
the OpenAPI spec; `/api/metrics` exposes Prometheus-format metrics.

## Kubernetes

```bash
# 1. Build and push images (replace with your registry)
docker build -f apps/api/Dockerfile -t registry.example/maximilian/api:latest .
docker build -f apps/worker/Dockerfile -t registry.example/maximilian/worker:latest .
docker build -f apps/dashboard/Dockerfile -t registry.example/maximilian/dashboard:latest .
docker push registry.example/maximilian/api:latest
docker push registry.example/maximilian/worker:latest
docker push registry.example/maximilian/dashboard:latest

# 2. Update image references in deploy/k8s/base/*.yaml to match your registry.

# 3. Configure secrets
# Either edit deploy/k8s/base/secret.yaml directly (replace REPLACE_ME_*)
# or source secrets from your secret manager and remove the stringData field.

# 4. Apply
kubectl apply -k deploy/k8s/base

# 5. Verify
kubectl -n maximilian get pods
kubectl -n maximilian port-forward svc/api 3001:3001
curl http://localhost:3001/api/health
```

### Prerequisites

- **NGINX Ingress Controller** — required for the Ingress resource.
- **cert-manager** — required for automatic TLS via Let's Encrypt.
  Configure your ClusterIssuer and edit the
  `cert-manager.io/cluster-issuer` annotation on the Ingress to match.
- **Storage class** for Postgres / Redis PVCs (the default class works
  on most managed clusters).

### Architecture

| Component | Replicas | HPA | Notes |
|-----------|----------|-----|-------|
| api       | 2 (min)  | 2-10 | CPU 70%, Memory 80% |
| worker    | 1 (min)  | 1-5  | CPU 75%, Memory 80% |
| dashboard | 2        | none | Static SPA, no need to scale |
| postgres  | 1        | none | StatefulSet, 20Gi PVC |
| redis     | 1        | none | StatefulSet, 5Gi PVC  |

For HA Postgres / Redis, replace the StatefulSets with managed
services (RDS, ElastiCache, Cloud SQL, etc.) and adjust
`DATABASE_URL` / `REDIS_URL` in the ConfigMap.

### Production checklist

- [ ] Replace all `REPLACE_ME_*` values in `secret.yaml` with real secrets
      (or source from a secret manager)
- [ ] Configure the Ingress annotation `cert-manager.io/cluster-issuer`
      to match your issuer
- [ ] Replace the postgres + redis StatefulSets with managed services
      if you need HA
- [ ] Set up backup snapshots for the postgres PVC
- [ ] Configure Prometheus to scrape `/api/metrics` from outside the cluster
      (the in-cluster Prometheus is optional via `--profile observability`
      on docker-compose, but in K8s you'll typically use a cluster-wide
      Prometheus)
- [ ] Set resource requests/limits based on observed load
- [ ] Configure PodDisruptionBudgets for API and worker to keep at least
      one replica available during node drains
- [ ] Network policies — restrict traffic so only the API talks to
      postgres + redis, only the dashboard ingress talks to the dashboard,
      etc. Not included by default; add as needed.