export const CREDENTIAL_LEASE_PROTOCOL_PACKAGE_NAME = '@max/credential-lease' as const;
export const CREDENTIAL_LEASE_PROTOCOL_VERSION = 1 as const;
export const CREDENTIAL_LEASE_AUDIENCE = 'maximilian-provider' as const;
export const CREDENTIAL_LEASE_SCOPES = ['provider.default'] as const;
export const CREDENTIAL_LEASE_MAX_FRAME_BYTES = 64 * 1024;
export const CREDENTIAL_LEASE_MAX_MIN_VALIDITY_MS = 5 * 60 * 1000;

const MAX_REQUEST_ID_LENGTH = 128;
const MAX_ACCESS_TOKEN_LENGTH = 32 * 1024;
const CAPABILITY_PATTERN = /^[a-f0-9]{64}$/u;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]+$/u;

export type CredentialLeaseMethod = 'status' | 'lease' | 'unauthorized';

export type CredentialLeaseRequest =
  | {
      version: 1;
      requestId: string;
      capability: string;
      method: 'status';
    }
  | {
      version: 1;
      requestId: string;
      capability: string;
      method: 'lease';
      minValidityMs: number;
    }
  | {
      version: 1;
      requestId: string;
      capability: string;
      method: 'unauthorized';
      generation: number;
    };

export type CredentialLeaseErrorCode =
  | 'AUTH_REQUIRED'
  | 'BROKER_UNAVAILABLE'
  | 'CAPABILITY_REJECTED'
  | 'PROTOCOL_MISMATCH'
  | 'INVALID_REQUEST'
  | 'INTERNAL_ERROR';

export type CredentialLeaseStatus =
  | 'anonymous'
  | 'authorizing'
  | 'authenticated'
  | 'refreshing'
  | 'scope_upgrade_required'
  | 'logging_out'
  | 'expired'
  | 'error';

export interface CredentialLeaseStatusResult {
  method: 'status';
  status: CredentialLeaseStatus;
  generation: number;
  expiresAtMs?: number;
}

export interface CredentialLeaseResult {
  method: 'lease';
  accessToken: string;
  expiresAtMs: number;
  generation: number;
  audience: typeof CREDENTIAL_LEASE_AUDIENCE;
  scopes: typeof CREDENTIAL_LEASE_SCOPES;
}

export interface CredentialLeaseUnauthorizedResult {
  method: 'unauthorized';
  action: 'retry' | 'logout';
}

export type CredentialLeaseSuccessResult =
  | CredentialLeaseStatusResult
  | CredentialLeaseResult
  | CredentialLeaseUnauthorizedResult;

export interface CredentialLeaseSuccessResponse {
  version: 1;
  requestId: string;
  ok: true;
  result: CredentialLeaseSuccessResult;
}

export interface CredentialLeaseFailureResponse {
  version: 1;
  requestId: string;
  ok: false;
  error: {
    code: CredentialLeaseErrorCode;
    message: string;
  };
}

export type CredentialLeaseResponse =
  | CredentialLeaseSuccessResponse
  | CredentialLeaseFailureResponse;

const ERROR_MESSAGES: Readonly<Record<CredentialLeaseErrorCode, string>> = Object.freeze({
  AUTH_REQUIRED: 'Authentication is required.',
  BROKER_UNAVAILABLE: 'Credential lease integration is unavailable.',
  CAPABILITY_REJECTED: 'Credential lease capability was rejected.',
  PROTOCOL_MISMATCH: 'Credential lease protocol is incompatible.',
  INVALID_REQUEST: 'Credential lease request is invalid.',
  INTERNAL_ERROR: 'Credential lease request failed.',
});

export class CredentialLeaseProtocolError extends Error {
  readonly code: CredentialLeaseErrorCode;

  constructor(code: CredentialLeaseErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = 'CredentialLeaseProtocolError';
    this.code = code;
  }
}

export function credentialLeaseErrorMessage(code: CredentialLeaseErrorCode): string {
  return ERROR_MESSAGES[code];
}

export function parseCredentialLeaseRequest(value: unknown): CredentialLeaseRequest {
  const record = requireRecord(value);
  if (record.version !== CREDENTIAL_LEASE_PROTOCOL_VERSION) {
    throw new CredentialLeaseProtocolError('PROTOCOL_MISMATCH');
  }
  const requestId = requireRequestId(record.requestId);
  const capability = requireCapability(record.capability);

  if (record.method === 'status') {
    requireExactKeys(record, ['version', 'requestId', 'capability', 'method']);
    return { version: 1, requestId, capability, method: 'status' };
  }
  if (record.method === 'lease') {
    requireExactKeys(record, ['version', 'requestId', 'capability', 'method', 'minValidityMs']);
    const minValidityMs = requireBoundedInteger(
      record.minValidityMs,
      0,
      CREDENTIAL_LEASE_MAX_MIN_VALIDITY_MS,
    );
    return { version: 1, requestId, capability, method: 'lease', minValidityMs };
  }
  if (record.method === 'unauthorized') {
    requireExactKeys(record, ['version', 'requestId', 'capability', 'method', 'generation']);
    const generation = requireBoundedInteger(record.generation, 0, Number.MAX_SAFE_INTEGER);
    return { version: 1, requestId, capability, method: 'unauthorized', generation };
  }
  throw new CredentialLeaseProtocolError('INVALID_REQUEST');
}

export function parseCredentialLeaseResponse(value: unknown): CredentialLeaseResponse {
  const record = requireRecord(value);
  if (record.version !== CREDENTIAL_LEASE_PROTOCOL_VERSION) {
    throw new CredentialLeaseProtocolError('PROTOCOL_MISMATCH');
  }
  const requestId = requireRequestId(record.requestId);
  if (record.ok === true) {
    requireExactKeys(record, ['version', 'requestId', 'ok', 'result']);
    return {
      version: 1,
      requestId,
      ok: true,
      result: parseSuccessResult(record.result),
    };
  }
  if (record.ok === false) {
    requireExactKeys(record, ['version', 'requestId', 'ok', 'error']);
    const error = requireRecord(record.error);
    requireExactKeys(error, ['code', 'message']);
    const code = requireErrorCode(error.code);
    if (error.message !== ERROR_MESSAGES[code]) {
      throw new CredentialLeaseProtocolError('INVALID_REQUEST');
    }
    return { version: 1, requestId, ok: false, error: { code, message: ERROR_MESSAGES[code] } };
  }
  throw new CredentialLeaseProtocolError('INVALID_REQUEST');
}

export function createCredentialLeaseFailureResponse(
  requestId: string,
  error: unknown,
): CredentialLeaseFailureResponse {
  const safeRequestId = requireRequestId(requestId);
  const code = error instanceof CredentialLeaseProtocolError ? error.code : 'INTERNAL_ERROR';
  return {
    version: CREDENTIAL_LEASE_PROTOCOL_VERSION,
    requestId: safeRequestId,
    ok: false,
    error: { code, message: ERROR_MESSAGES[code] },
  };
}

export function createCredentialLeaseSuccessResponse(
  requestId: string,
  result: CredentialLeaseSuccessResult,
): CredentialLeaseSuccessResponse {
  return parseCredentialLeaseResponse({
    version: CREDENTIAL_LEASE_PROTOCOL_VERSION,
    requestId,
    ok: true,
    result,
  }) as CredentialLeaseSuccessResponse;
}

function parseSuccessResult(value: unknown): CredentialLeaseSuccessResult {
  const result = requireRecord(value);
  if (result.method === 'status') return parseStatusResult(result);
  if (result.method === 'lease') return parseLeaseResult(result);
  if (result.method === 'unauthorized') return parseUnauthorizedResult(result);
  throw new CredentialLeaseProtocolError('INVALID_REQUEST');
}

function parseStatusResult(result: Record<string, unknown>): CredentialLeaseStatusResult {
  const allowedKeys = ['method', 'status', 'generation'];
  if (result.expiresAtMs !== undefined) allowedKeys.push('expiresAtMs');
  requireExactKeys(result, allowedKeys);
  const statuses: readonly CredentialLeaseStatus[] = [
    'anonymous',
    'authorizing',
    'authenticated',
    'refreshing',
    'scope_upgrade_required',
    'logging_out',
    'expired',
    'error',
  ];
  if (!statuses.includes(result.status as CredentialLeaseStatus)) {
    throw new CredentialLeaseProtocolError('INVALID_REQUEST');
  }
  const status = result.status as CredentialLeaseStatus;
  const generation = requireBoundedInteger(result.generation, 0, Number.MAX_SAFE_INTEGER);
  if (result.expiresAtMs === undefined) return { method: 'status', status, generation };
  return {
    method: 'status',
    status,
    generation,
    expiresAtMs: requireBoundedInteger(result.expiresAtMs, 0, Number.MAX_SAFE_INTEGER),
  };
}

function parseLeaseResult(result: Record<string, unknown>): CredentialLeaseResult {
  requireExactKeys(result, [
    'method',
    'accessToken',
    'expiresAtMs',
    'generation',
    'audience',
    'scopes',
  ]);
  if (
    typeof result.accessToken !== 'string' ||
    result.accessToken.length === 0 ||
    result.accessToken.length > MAX_ACCESS_TOKEN_LENGTH ||
    result.audience !== CREDENTIAL_LEASE_AUDIENCE ||
    !Array.isArray(result.scopes) ||
    result.scopes.length !== 1 ||
    result.scopes[0] !== CREDENTIAL_LEASE_SCOPES[0]
  ) {
    throw new CredentialLeaseProtocolError('INVALID_REQUEST');
  }
  return {
    method: 'lease',
    accessToken: result.accessToken,
    expiresAtMs: requireBoundedInteger(result.expiresAtMs, 0, Number.MAX_SAFE_INTEGER),
    generation: requireBoundedInteger(result.generation, 0, Number.MAX_SAFE_INTEGER),
    audience: CREDENTIAL_LEASE_AUDIENCE,
    scopes: CREDENTIAL_LEASE_SCOPES,
  };
}

function parseUnauthorizedResult(result: Record<string, unknown>): CredentialLeaseUnauthorizedResult {
  requireExactKeys(result, ['method', 'action']);
  if (result.action !== 'retry' && result.action !== 'logout') {
    throw new CredentialLeaseProtocolError('INVALID_REQUEST');
  }
  return { method: 'unauthorized', action: result.action };
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new CredentialLeaseProtocolError('INVALID_REQUEST');
  }
  return value as Record<string, unknown>;
}

function requireExactKeys(record: Record<string, unknown>, allowed: readonly string[]): void {
  const allowedKeys = new Set(allowed);
  if (Object.keys(record).some((key) => !allowedKeys.has(key))) {
    throw new CredentialLeaseProtocolError('INVALID_REQUEST');
  }
}

function requireRequestId(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_REQUEST_ID_LENGTH ||
    !REQUEST_ID_PATTERN.test(value)
  ) {
    throw new CredentialLeaseProtocolError('INVALID_REQUEST');
  }
  return value;
}

function requireCapability(value: unknown): string {
  if (typeof value !== 'string' || !CAPABILITY_PATTERN.test(value)) {
    throw new CredentialLeaseProtocolError('INVALID_REQUEST');
  }
  return value;
}

function requireBoundedInteger(value: unknown, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new CredentialLeaseProtocolError('INVALID_REQUEST');
  }
  return value as number;
}

function requireErrorCode(value: unknown): CredentialLeaseErrorCode {
  if (typeof value !== 'string' || !(value in ERROR_MESSAGES)) {
    throw new CredentialLeaseProtocolError('INVALID_REQUEST');
  }
  return value as CredentialLeaseErrorCode;
}
