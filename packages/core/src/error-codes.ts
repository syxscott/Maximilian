/**
 * Structured error catalog.
 *
 * Every public Maximilian error has a stable code (`MAX-XXXX`) and
 * metadata for self-service troubleshooting. Consumers should branch
 * on `code` rather than parsing messages.
 *
 * Codes are grouped by domain:
 *   1XXX — auth / authorization
 *   2XXX — workspaces / executions
 *   3XXX — agents / capabilities
 *   4XXX — LLM / provider
 *   5XXX — meta-system / evolution / truth-audit
 *   6XXX — queue / task
 *   7XXX — config / feature flags
 *   9XXX — internal / unexpected
 */

export type ErrorDomain =
  | "auth"
  | "workspaces"
  | "agents"
  | "llm"
  | "meta-system"
  | "queue"
  | "config"
  | "internal"

export interface ErrorCode {
  code: string
  domain: ErrorDomain
  httpStatus: number
  title: string
  description: string
  /** Human-friendly remediation hint shown in the dashboard. */
  remediation?: string
  /** Whether this error is safe to retry automatically. */
  retryable: boolean
}

export const ERROR_CATALOG = {
  // 1XXX — auth
  "MAX-1001": {
    code: "MAX-1001",
    domain: "auth",
    httpStatus: 401,
    title: "Missing credentials",
    description: "No Authorization header present",
    retryable: false,
  },
  "MAX-1002": {
    code: "MAX-1002",
    domain: "auth",
    httpStatus: 401,
    title: "Invalid token",
    description: "Bearer token failed JWT verification",
    remediation: "Refresh the token via POST /api/auth/refresh",
    retryable: false,
  },
  "MAX-1003": {
    code: "MAX-1003",
    domain: "auth",
    httpStatus: 403,
    title: "Insufficient role",
    description: "Authenticated user does not have the required role for this resource",
    retryable: false,
  },
  "MAX-1004": {
    code: "MAX-1004",
    domain: "auth",
    httpStatus: 429,
    title: "Rate limit exceeded",
    description: "Per-IP or per-token rate limit hit",
    remediation: "Wait and retry with exponential backoff",
    retryable: true,
  },

  // 2XXX — workspaces
  "MAX-2001": {
    code: "MAX-2001",
    domain: "workspaces",
    httpStatus: 404,
    title: "Workspace not found",
    description: "The requested workspace id does not exist (or belongs to another tenant)",
    retryable: false,
  },
  "MAX-2002": {
    code: "MAX-2002",
    domain: "workspaces",
    httpStatus: 409,
    title: "Workspace already exists",
    description: "A workspace with this id is already present",
    retryable: false,
  },
  "MAX-2003": {
    code: "MAX-2003",
    domain: "workspaces",
    httpStatus: 422,
    title: "Invalid plan",
    description: "The plan produced by Commander was not executable (missing dependencies, infinite loop)",
    remediation: "Inspect the plan in the workspace detail view",
    retryable: false,
  },

  // 3XXX — agents / capabilities
  "MAX-3001": {
    code: "MAX-3001",
    domain: "agents",
    httpStatus: 404,
    title: "Unknown agent",
    description: "The requested agent role is not registered",
    retryable: false,
  },
  "MAX-3002": {
    code: "MAX-3002",
    domain: "agents",
    httpStatus: 409,
    title: "Agent version conflict",
    description: "The requested agent version has been retired",
    retryable: false,
  },

  // 4XXX — LLM / provider
  "MAX-4001": {
    code: "MAX-4001",
    domain: "llm",
    httpStatus: 502,
    title: "Provider error",
    description: "Upstream LLM provider returned 5xx",
    retryable: true,
  },
  "MAX-4002": {
    code: "MAX-4002",
    domain: "llm",
    httpStatus: 429,
    title: "Provider rate-limited",
    description: "Upstream LLM provider returned 429",
    remediation: "Wait, or switch provider via /api/providers/default",
    retryable: true,
  },
  "MAX-4003": {
    code: "MAX-4003",
    domain: "llm",
    httpStatus: 401,
    title: "Provider auth failed",
    description: "The LLM provider rejected the API key",
    remediation: "Update LLM_<PROVIDER>_API_KEY in .env and restart",
    retryable: false,
  },
  "MAX-4004": {
    code: "MAX-4004",
    domain: "llm",
    httpStatus: 504,
    title: "Provider timeout",
    description: "Upstream LLM provider did not respond within the deadline",
    retryable: true,
  },

  // 5XXX — meta-system
  "MAX-5001": {
    code: "MAX-5001",
    domain: "meta-system",
    httpStatus: 503,
    title: "Meta-system disabled",
    description: "META_AGENT_ENABLED is false; this endpoint is unavailable",
    remediation: "Set META_AGENT_ENABLED=true and restart the API",
    retryable: false,
  },
  "MAX-5002": {
    code: "MAX-5002",
    domain: "meta-system",
    httpStatus: 409,
    title: "Governance violation",
    description: "The proposed action exceeds a governance limit",
    retryable: false,
  },
  "MAX-5003": {
    code: "MAX-5003",
    domain: "meta-system",
    httpStatus: 422,
    title: "TruthAudit drift",
    description: "The recorded measurements deviate from predictions beyond threshold",
    remediation: "Re-calibrate the simulation model or retire the capability",
    retryable: false,
  },

  // 6XXX — queue
  "MAX-6001": {
    code: "MAX-6001",
    domain: "queue",
    httpStatus: 503,
    title: "Queue unavailable",
    description: "TASK_QUEUE_ENABLED is false; this endpoint is unavailable",
    retryable: false,
  },
  "MAX-6002": {
    code: "MAX-6002",
    domain: "queue",
    httpStatus: 500,
    title: "Job failed",
    description: "BullMQ reported the job as failed after all retries",
    retryable: false,
  },

  // 7XXX — config / feature flags
  "MAX-7001": {
    code: "MAX-7001",
    domain: "config",
    httpStatus: 500,
    title: "Invalid environment",
    description: "Required environment variables are missing or malformed",
    remediation: "Run `pnpm --filter @max/api config:check`",
    retryable: false,
  },
  "MAX-7002": {
    code: "MAX-7002",
    domain: "config",
    httpStatus: 404,
    title: "Unknown feature flag",
    description: "The requested flag name is not defined",
    retryable: false,
  },

  // 9XXX — internal
  "MAX-9001": {
    code: "MAX-9001",
    domain: "internal",
    httpStatus: 500,
    title: "Internal error",
    description: "An unexpected error occurred. The error has been logged.",
    retryable: false,
  },
} as const satisfies Record<string, ErrorCode>

export type ErrorCodeValue = keyof typeof ERROR_CATALOG

export class MaximilianError extends Error {
  readonly code: ErrorCodeValue
  readonly httpStatus: number
  readonly domain: ErrorDomain
  readonly retryable: boolean
  readonly remediation?: string
  readonly details?: Record<string, unknown>

  constructor(code: ErrorCodeValue, message?: string, details?: Record<string, unknown>) {
    const def = ERROR_CATALOG[code]
    super(message ?? def.title)
    this.name = "MaximilianError"
    this.code = code
    this.httpStatus = def.httpStatus
    this.domain = def.domain
    this.retryable = def.retryable
    this.remediation = "remediation" in def ? def.remediation : undefined
    this.details = details
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        title: ERROR_CATALOG[this.code].title,
        message: this.message,
        remediation: this.remediation,
        retryable: this.retryable,
        domain: this.domain,
        details: this.details,
      },
    }
  }
}

/** Convenience: get the full error definition. */
export function getErrorDef(code: ErrorCodeValue): ErrorCode {
  return ERROR_CATALOG[code]
}

/** Convenience: list every error code grouped by domain. */
export function listErrorCodes(): ErrorCode[] {
  return Object.values(ERROR_CATALOG)
}