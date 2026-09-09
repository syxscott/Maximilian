import { z } from "zod"
import { resolve as resolvePath } from "node:path"

const booleanString = z
  .enum(["true", "false"])
  .default("true")
  .transform((v) => v === "true")

const optionalBooleanString = z
  .enum(["true", "false"])
  .default("false")
  .transform((v) => v === "true")

const RolloutModeSchema = z.enum(["shadow", "canary", "full"]).default("shadow")

export const ConfigSchema = z.object({
  // Server
  PORT: z.coerce.number().int().positive().default(3001),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

  // Storage. WORKSPACE_DIR is normalized to an absolute path at parse time so
  // every consumer (file stores, blueprint store, execution store) sees the
  // same resolved location — critical on Windows where CWD-relative paths
  // resolved later can land in different drives after a chdir. Reject paths
  // containing NUL bytes (POSIX path terminator) so the process fails fast
  // instead of corrupting data mid-run. .default() comes AFTER .refine() so
  // defaults still satisfy the emptiness / NUL-byte checks.
  WORKSPACE_DIR: z
    .string()
    .default("./workspaces")
    .refine((p) => p.length > 0, "WORKSPACE_DIR cannot be empty")
    .refine((p) => !p.includes("\0"), "WORKSPACE_DIR must not contain NUL bytes")
    .transform((p) => resolvePath(p)),

  // Auth
  ADMIN_TOKEN: z.string().optional(),
  JWT_SECRET: z.string().optional(),
  JWT_EXPIRES_IN: z.string().default("15m"),
  JWT_REFRESH_EXPIRES_IN: z.string().default("7d"),

  // CORS
  CORS_ORIGIN: z.string().default("http://localhost:5174"),

  // Trust proxy — comma-separated CIDR/IP list. When set, rate-limiting
  // and request logging trust X-Forwarded-For / X-Real-IP only from
  // connections originating in this list. When empty (the default), those
  // headers are ignored entirely and the socket's remote address is used,
  // preventing trivial rate-limit bypass via spoofed headers.
  TRUSTED_PROXIES: z.string().default(""),

  // Database
  DATABASE_URL: z.string().optional(),

  // Task queue (BullMQ / Redis)
  REDIS_URL: z.string().optional(),
  TASK_QUEUE_ENABLED: optionalBooleanString,
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(3),

  // Multi-tenancy
  MULTI_TENANT_ENABLED: optionalBooleanString,

  // LLM Provider API Keys (optional — at least one needed at runtime)
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_MODEL: z.string().optional(),
  DEEPSEEK_API_KEY: z.string().optional(),
  DEEPSEEK_MODEL: z.string().optional(),

  // Feature flags
  DAGS_MODE: optionalBooleanString,
  META_AGENT_ENABLED: optionalBooleanString,
  EVOLUTION_ENABLED: booleanString,
  // Directory of sealed files (benchmark corpus / eval fixtures) that the
  // evolution engine must not modify mid-run. When set, every evolution
  // cycle is guarded by a SealedFileVault rooted here; a changed sealed
  // file aborts the cycle instead of promoting a candidate that was
  // measured against a silently-moved target. Unset = no vault (default).
  EVOLUTION_SEALED_DIR: z
    .string()
    .optional()
    .transform((p) => (p ? resolvePath(p) : undefined)),
  DIGITAL_TWIN_ENABLED: optionalBooleanString,
  TELEMETRY_ENABLED: booleanString,
  SAFE_ROLLOUT_MODE: RolloutModeSchema,

  // Telemetry
  TELEMETRY_BUFFER_SIZE: z.coerce.number().int().positive().default(1000),
  TELEMETRY_PERSIST_PATH: z.string().optional(),

  // OpenTelemetry
  OTEL_ENABLED: optionalBooleanString,
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
  OTEL_SERVICE_NAME: z.string().default("maximilian-api"),

  // Meta-system
  META_ROOT_DIR: z.string().optional(),

  // Event retention
  EVENT_RETENTION_DAYS: z.coerce.number().int().positive().default(30),

  // Durable event-log storage. When set, per-workspace append-only JSONL
  // event logs are written under `<EVENTS_DIR>/{workspaceId}.jsonl`. The
  // SSE replay endpoint (`/api/workspaces/:id/stream-durable`) reads
  // from this log so a reconnecting client can resume from any point in
  // history. Defaults to `<WORKSPACE_DIR>/events/` so events live next
  // to workspace state by default.
  EVENTS_DIR: z.string().optional(),

  // Logging
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

  // Sandbox backend (借鉴 Open Interpreter multi-backend)
  // Supported values: local | docker | mac-sandbox-exec | process
  SANDBOX_BACKEND: z.enum(["local", "docker", "mac-sandbox-exec", "process"]).default("local"),
})

export type Config = z.infer<typeof ConfigSchema>
