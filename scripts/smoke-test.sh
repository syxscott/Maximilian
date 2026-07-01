#!/usr/bin/env bash
# Smoke test for docker-compose deployment.
#
# Run from repo root on a host with docker + docker compose:
#   bash scripts/smoke-test.sh
#
# Exits non-zero on first failure so it can gate CI. Tests:
#   1. compose config syntax
#   2. postgres reachable + accept connections
#   3. api responds to /api/health
#   4. /api/metrics returns Prometheus format
#   5. /api/openapi.json is valid OpenAPI 3.x
#   6. register + login + authed request flow
#   7. (queue profile) worker heartbeat present in Redis
#
# Use BASE_URL env var to target a non-localhost host. Defaults to
# http://localhost:3001.

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3001}"
COMPOSE_PROJECT_DIR="${COMPOSE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

red()    { printf "\033[31m%s\033[0m\n" "$*"; }
green()  { printf "\033[32m%s\033[0m\n" "$*"; }
yellow() { printf "\033[33m%s\033[0m\n" "$*"; }

step()   { echo; yellow "▶ $*"; }
pass()   { green "  ✓ $*"; }
fail()   { red "  ✗ $*"; exit 1; }

require() {
  command -v "$1" >/dev/null 2>&1 || { red "missing: $1"; exit 2; }
}

require docker
require curl
require jq

# ── 1. compose config ────────────────────────────────────────────────────
step "Validating docker-compose.yml"
( cd "$COMPOSE_PROJECT_DIR" && docker compose config -q ) && pass "compose config valid"

# ── 2. bring up postgres + api ──────────────────────────────────────────
step "Starting postgres + api"
( cd "$COMPOSE_PROJECT_DIR" && docker compose up -d postgres api )

# Wait for api to become healthy (compose's healthcheck retries 3x).
echo "  waiting for api to become healthy..."
for i in $(seq 1 30); do
  state=$(cd "$COMPOSE_PROJECT_DIR" && docker compose ps --format json api 2>/dev/null | jq -r '.[0].Health // "starting"' 2>/dev/null || echo starting)
  if [ "$state" = "healthy" ]; then
    pass "api is healthy"
    break
  fi
  sleep 2
  if [ "$i" = 30 ]; then
    fail "api never became healthy; check 'docker compose logs api'"
  fi
done

# ── 3. /api/health ──────────────────────────────────────────────────────
step "GET /api/health"
HEALTH=$(curl -fsS "$BASE_URL/api/health")
echo "  $HEALTH"
echo "$HEALTH" | jq -e '.status == "ok"' >/dev/null \
  && pass "health reports ok" \
  || fail "health did not return ok"

# ── 4. /api/metrics ─────────────────────────────────────────────────────
step "GET /api/metrics"
METRICS=$(curl -fsS "$BASE_URL/api/metrics")
echo "$METRICS" | grep -q "^# HELP" \
  && pass "metrics endpoint returns Prometheus format" \
  || fail "metrics endpoint did not return Prometheus format"

# ── 5. /api/openapi.json ────────────────────────────────────────────────
step "GET /api/openapi.json"
OPENAPI=$(curl -fsS "$BASE_URL/api/openapi.json")
echo "$OPENAPI" | jq -e '.openapi | startswith("3.")' >/dev/null \
  && pass "openapi version is 3.x" \
  || fail "openapi spec is not version 3.x"

# ── 6. auth flow ────────────────────────────────────────────────────────
step "Auth flow: register → login → authed read"
EMAIL="smoke-$(date +%s)@smoke.local"
PASSWORD="SmokeTest123!"

REG=$(curl -fsS -X POST "$BASE_URL/api/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
TOKEN=$(echo "$REG" | jq -r '.accessToken')
[ -n "$TOKEN" ] && [ "$TOKEN" != "null" ] \
  && pass "register returned accessToken" \
  || fail "register did not return accessToken: $REG"

LOGIN=$(curl -fsS -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
echo "$LOGIN" | jq -e '.accessToken' >/dev/null \
  && pass "login returned accessToken" \
  || fail "login did not return accessToken: $LOGIN"

WS=$(curl -fsS "$BASE_URL/api/workspaces?limit=5" \
  -H "Authorization: Bearer $TOKEN")
echo "$WS" | jq -e '.items | type == "array"' >/dev/null \
  && pass "authed workspaces list returns items array" \
  || fail "authed workspaces list did not return items: $WS"

# ── 7. (optional) worker heartbeat ──────────────────────────────────────
step "Worker heartbeat (only with --profile queue)"
if ( cd "$COMPOSE_PROJECT_DIR" && docker compose --profile queue up -d worker redis 2>/dev/null ); then
  sleep 8
  HB=$(cd "$COMPOSE_PROJECT_DIR" && docker compose exec -T redis redis-cli get maximilian:worker:heartbeat 2>/dev/null || true)
  if [ -n "$HB" ]; then
    pass "worker heartbeat present in Redis: $HB"
  else
    yellow "  ⚠ worker not running or heartbeat missing — skip"
  fi
else
  yellow "  ⚠ queue profile not enabled — skip heartbeat check"
fi

echo
green "✅ smoke test passed"