# Maximilian

> Meta-agent OS — a self-evolving multi-agent system with capability discovery,
> team composition, governance, and human-in-the-loop approval.

## What is this?

A user submits a request. A **Commander** agent decomposes it into a task plan.
A **team of specialized agents** (frontend, backend, reviewer, …) executes the
plan in parallel where possible. A **Reviewer** scores the output. A **meta-system**
observes the whole thing, proposes new capabilities, births new agents, retires
underperformers — and asks a human when something is high-risk or irreversible.

```
User Request
    ↓
Commander (LLM planning) / DAGS (dynamic team composition)
    ↓
Specialized Agents (frontend / backend / data / review / …) — concurrent
    ↓
Review Agent (quality check, score 0-10)
    ↓
Workspace (PostgreSQL or file system)

(meta-system, runs in background after every workspace)
    ↓
Discovery → Birth / Retire / Split / Merge
    ↓
Governance → HITL approval (when risk > threshold)
    ↓
Safe rollout (shadow / canary / full)
```

## Stack

| Layer | Choice |
|---|---|
| **API** | Hono on Node.js 20+, TypeScript, OpenAPIHono |
| **Frontend** | React 19 + Vite |
| **LLM** | OpenAI / Anthropic / OpenRouter / DeepSeek via unified `@max/providers` |
| **Storage** | PostgreSQL (Drizzle ORM) — falls back to file-based when `DATABASE_URL` is unset |
| **Queue** | BullMQ + Redis (when `TASK_QUEUE_ENABLED=true`) |
| **Auth** | JWT (jose) + bcryptjs, with optional `ADMIN_TOKEN` fallback |
| **Observability** | Pino logs, OpenTelemetry traces, Prometheus metrics, structured SSE events |
| **Tests** | Vitest, ~970 tests across 24 packages |

## Prerequisites

- Node.js >= 20
- pnpm >= 9
- At least one LLM API key
- (Optional) PostgreSQL 16+ and Redis 7+ for production mode

## Quick start (development, file storage)

```bash
pnpm install
cp .env.example .env
# Edit .env — add at least one LLM API key
pnpm dev
```

Open <http://localhost:5174> for the dashboard (dev mode, served by Vite).
The API is at <http://localhost:3001/api/health>.
Swagger UI: <http://localhost:3001/api/docs>.

> The Docker Compose stack serves the dashboard on **port 5173** (nginx in
> the dashboard container). The 5174 default applies to `pnpm dev` only.

## Quick start (production, full stack)

```bash
# Bring up postgres + api + dashboard + worker + redis + otel + prom
docker compose --profile queue --profile observability up -d

# Bootstrap: create first admin user
pnpm bootstrap
```

See `docs/operations/deployment.md` for the full runbook.

## Feature flags

| Flag | Default | Effect |
|---|---|---|
| `EVOLUTION_ENABLED` | `true` | Profile store + leaderboard + auto-promotion |
| `DAGS_MODE` | `false` | Use DAGS team composition (skips Commander) |
| `META_AGENT_ENABLED` | `false` | Discovery + birth/retire + governance cycle |
| `DIGITAL_TWIN_ENABLED` | `false` | Simulate-before-apply + safe rollout (requires meta) |
| `TELEMETRY_ENABLED` | `true` | TelemetryCollector + Prometheus |
| `TASK_QUEUE_ENABLED` | `false` | Enqueue chat jobs to BullMQ instead of in-process |
| `MULTI_TENANT_ENABLED` | `false` | Enforce tenant isolation in every store |

## Auth modes

1. **Dev mode** — no `JWT_SECRET` and no `ADMIN_TOKEN` set. No auth.
2. **Single-tenant** — set `ADMIN_TOKEN=…`. Endpoints accept `Authorization:
   Bearer <token>`.
3. **Multi-user** — set `JWT_SECRET=…` + `DATABASE_URL=…`. Users register via
   `POST /api/auth/register`, log in via `POST /api/auth/login`, refresh via
   `POST /api/auth/refresh`. RBAC: `admin` / `operator` / `viewer`.
4. **Production** — `NODE_ENV=production` requires `JWT_SECRET` or
   `ADMIN_TOKEN`; otherwise the server refuses to start.

## Project structure

```
apps/
  api/         Hono server, OpenAPI, all HTTP routes
  dashboard/   React 19 UI (workspace, executions, governance, evolution)
  tui/         Terminal UI (SolidJS-style React, OpenCode-port lineage)
  worker/      BullMQ worker (pulls jobs, executes, writes results)

packages/
  core/            Agent runtime, plan/task/result types
  providers/       Unified LLM provider + retry + circuit-breaker
  dags/            Team graph composition
  evolution/       Profile store, leaderboard, version snapshots
  autonomy/        Execution store, learning API, orchestrator
  meta-system/     Discovery, birth, retirement, governance, HITL
  database/        Drizzle schema + 11 PG stores (file fallback when `DATABASE_URL` is unset)
  queue/           BullMQ producer + worker + heartbeat
  telemetry/       Pino logger, OTel, Prometheus
  config/          Zod-validated env vars, feature flags
  agents/          Concrete agent implementations (Backend / Frontend / Data / Review)
  commander/       LLM-driven request decomposition
  llm/             Generation options, presets, tool calls, error types
  workspace/       File workspace store + atomic write helpers
  sdk/             Client SDK used by the TUI
  tools/           Tool registry + bash/read/grep/edit/glob impls
  i18n/            Locale catalog + plural rules
  ui-react/        React component primitives
  ui-state/        Cross-component state store
  compat-shims/    Backwards-compat re-exports
  benchmark-core/  Benchmark harness

docs/
  changelogs/      Per-phase detail
  architecture/    Design docs
  operations/      Deployment runbooks

.github/workflows/  CI (ci.yml) + CD (deploy.yml)
docker-compose.yml  Full stack
```

## Running tests

```bash
pnpm test                       # All packages, all tests
pnpm --filter @max/api test     # Just the API
pnpm type-check                 # TypeScript only
pnpm lint                       # Lint only
```

The full suite runs in CI on every push to main. PostgreSQL is provided as a
service container so DB-dependent tests can run against a real instance.

## API documentation

- OpenAPI 3.1 spec: <http://localhost:3001/api/openapi.json>
- Swagger UI: <http://localhost:3001/api/docs>
- Route definitions: `apps/api/src/routes/*.ts` (each file exports `createRoute`
  definitions via `@hono/zod-openapi`)

All 86 routes are documented across 13 tag groups: auth, chat, evolution,
executions, governance, learning, meta, observability, permissions, system,
tenants, usage, workspaces.

## Production deployment

See `docs/operations/deployment.md` for the full runbook covering:

- Self-hosted (Docker Compose / Kubernetes)
- Generating a production `JWT_SECRET`
- Initial database migration
- First admin user
- Worker scaling
- Prometheus / Grafana
- OpenTelemetry collector
- Backup & restore
- Troubleshooting

## Security

See `SECURITY.md` for the vulnerability disclosure policy.

## License

[To be determined]

## Platform support

| Platform | API | Dashboard | TUI | Worker |
|---|---|---|---|---|
| Linux (x64 / arm64) | OK | OK | OK | OK |
| macOS 13+ (Apple Silicon / Intel) | OK | OK | OK | OK |
| Windows 11 (x64) | OK | OK | OK¹ | OK |

Tested on Node 20+ via [Volta](https://volta.sh) or `nvm`. The dashboard uses
standard React/Vite — no Windows-specific code. The API is pure Node and runs
identically on all three OSes.

¹ TUI on Windows 11 requires Windows Terminal 1.18+ (or PowerShell 7+) for
ANSI color, emoji, and box-drawing characters. Legacy `conhost` (cmd.exe on
older Windows builds) degrades to ASCII. The launcher script
`scripts/maximilian.cmd` is the supported entry point.

### Windows 11 caveats

**TUI on Windows 11:**

- Run from **Windows Terminal** or PowerShell for ANSI color/emoji support.
  Plain `cmd.exe` in older builds needs `VirtualTerminalLevel=1`; Win 11
  22H2+ defaults to ANSI on.
- Use the launcher scripts in `scripts/`:
  - `scripts/maximilian.cmd` — cmd.exe / Windows Terminal (primary)
  - `scripts/maximilian.ps1`  — PowerShell 5+
  - `scripts/maximilian.sh`   — Git Bash / MSYS2 / WSL
- After `pnpm --filter @max/tui build`, `pnpm install` installs
  `maximilian.cmd` and `maximilian.ps1` shims via the TUI package's `bin`
  field. Older cmd.exe users may need
  `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` for the `.ps1` shim.
- File-based locale persistence writes to `%LOCALAPPDATA%\maximilian\locale`
  (honors `MAXIMILIAN_STATE_DIR` / `XDG_STATE_HOME` for overrides).
- Windows console line-drawing characters (box drawing, braille spinners)
  render correctly in Windows Terminal 1.18+ and ConEmu. They degrade to
  ASCII in legacy conhost.

**API on Windows 11:**

- `WORKSPACE_DIR` is resolved to an absolute path at config-load time so
  store paths don't drift if `process.chdir()` is called mid-run. Use
  forward slashes — `node:path` normalizes both Windows and POSIX separators.
- Long paths (>260 chars) require `LongPathsEnabled` in the registry or
  the Node long-path workaround. Default workspace IDs are short enough
  to stay under MAX_PATH.
- The BullMQ worker requires Redis — install via `choco install redis-64`
  or run Redis in WSL/Docker.

**Docker:** Use `docker compose up` from any platform — the compose file is
OS-agnostic.

### Reporting platform bugs

If Maximilian misbehaves on a specific platform, please open an issue and
include:

- `node --version`, OS build (`winver` / `sw_vers` / `uname -a`)
- Terminal emulator + version
- `MAXIMILIAN_LOCALE` and `MAXIMILIAN_STATE_DIR` if relevant
