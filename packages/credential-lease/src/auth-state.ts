import { readFile } from 'node:fs/promises';

import { atomicWritePrivateFile } from './atomic-write.js';

export const AUTH_STATE_SCHEMA_VERSION = 1 as const;

export type AuthStatus =
  | 'anonymous'
  | 'authorizing'
  | 'authenticated'
  | 'refreshing'
  | 'scope_upgrade_required'
  | 'logging_out'
  | 'expired'
  | 'error';

const AUTH_STATUSES: readonly AuthStatus[] = [
  'anonymous',
  'authorizing',
  'authenticated',
  'refreshing',
  'scope_upgrade_required',
  'logging_out',
  'expired',
  'error',
];

/**
 * Persisted auth state. Mirrors the source protocol's security posture: secrets
 * (access/refresh tokens) are never persisted here — the state file carries only
 * the lifecycle status, generation counter, and expiry metadata.
 */
export interface AuthState {
  schemaVersion: typeof AUTH_STATE_SCHEMA_VERSION;
  status: AuthStatus;
  generation: number;
  expiresAtMs?: number;
  updatedAtMs: number;
}

const SENSITIVE_KEY_PATTERN =
  /access[_-]?token|refresh[_-]?token|device[_-]?code|code[_-]?verifier/iu;

function assertNoSensitiveKeys(value: unknown): void {
  if (typeof value !== 'object' || value === null) return;
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      throw new TypeError('Sensitive credential fields cannot be persisted in auth-state.json.');
    }
    assertNoSensitiveKeys(child);
  }
}

export function parseAuthState(value: unknown): AuthState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Invalid credential lease state.');
  }
  const state = value as Record<string, unknown>;
  const allowedKeys = ['schemaVersion', 'status', 'generation', 'updatedAtMs'];
  if (state.expiresAtMs !== undefined) allowedKeys.push('expiresAtMs');
  requireExactKeys(state, allowedKeys);
  const valid =
    state.schemaVersion === AUTH_STATE_SCHEMA_VERSION &&
    typeof state.status === 'string' &&
    AUTH_STATUSES.includes(state.status as AuthStatus) &&
    Number.isSafeInteger(state.generation) &&
    (state.generation as number) >= 0 &&
    typeof state.updatedAtMs === 'number' &&
    Number.isFinite(state.updatedAtMs) &&
    (state.expiresAtMs === undefined ||
      (typeof state.expiresAtMs === 'number' && Number.isFinite(state.expiresAtMs)));
  if (!valid) throw new TypeError('Invalid credential lease state.');
  assertNoSensitiveKeys(state);
  return state as unknown as AuthState;
}

function requireExactKeys(record: Record<string, unknown>, allowed: readonly string[]): void {
  const allowedKeys = new Set(allowed);
  if (Object.keys(record).some((key) => !allowedKeys.has(key))) {
    throw new TypeError('Invalid credential lease state.');
  }
}

/** JSON-file persistence for the auth state, using atomic private-file writes. */
export class AuthStateStore {
  constructor(private readonly path: string) {}

  async read(): Promise<AuthState | null> {
    let raw: string;
    try {
      raw = await readFile(this.path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    try {
      return parseAuthState(JSON.parse(raw));
    } catch (error) {
      if (error instanceof TypeError) throw error;
      throw new TypeError('Invalid credential lease state.');
    }
  }

  async write(state: AuthState): Promise<void> {
    const validated = parseAuthState(state);
    await atomicWritePrivateFile(this.path, `${JSON.stringify(validated, null, 2)}\n`);
  }
}
