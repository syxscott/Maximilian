import { rm } from 'node:fs/promises';

import { writeCapabilityFile, createCapability } from './capability.js';
import {
  CREDENTIAL_LEASE_AUDIENCE,
  CREDENTIAL_LEASE_PROTOCOL_VERSION,
  CREDENTIAL_LEASE_SCOPES,
  CredentialLeaseProtocolError,
  resolveCredentialLeaseEndpoint,
  startCredentialLeaseServer,
  type CredentialLeaseRequest,
  type CredentialLeaseSuccessResult,
  type CredentialLeaseServer,
} from './contracts.js';
import type { AccessTokenLease, AuthStatusSnapshot } from './auth-machine.js';

const NOOP_LOGGER: CredentialLeaseLogger = {
  info: () => undefined,
  warn: () => undefined,
};

export interface CredentialLeaseLogger {
  info(message: string): void;
  warn(message: string): void;
}

/** Session the broker fronts. Satisfied by {@link CredentialAuthMachine}. */
export interface CredentialLeaseSession {
  getStatus(): Promise<AuthStatusSnapshot>;
  getAccessToken(minValidityMs: number): Promise<AccessTokenLease>;
  handleUnauthorized(generation: number): Promise<'retry' | 'logout'>;
  subscribe(listener: (status: AuthStatusSnapshot) => void): () => void;
}

export interface CredentialLeaseBroker {
  endpoint: string;
  capabilityFile: string;
  dispose(): Promise<void>;
}

export interface StartCredentialLeaseBrokerOptions {
  stateDir: string;
  session: CredentialLeaseSession;
  now?: () => number;
  logger?: CredentialLeaseLogger;
}

/**
 * Local OAuth-style lease broker, ported from minimax-code's tools-host broker.
 * Serves the auth session over a capability-protected Unix socket with:
 * single-flight lease acquisition (in-flight promise dedup per epoch),
 * epoch invalidation on unauthorized reports, admission gating on the session
 * status (only authenticated/refreshing sessions admit leases), and a
 * monotonic minimum generation floor.
 */
export async function startCredentialLeaseBroker(
  options: StartCredentialLeaseBrokerOptions,
): Promise<CredentialLeaseBroker> {
  const endpoint = resolveCredentialLeaseEndpoint(options.stateDir);
  const capability = createCapability();
  const now = options.now ?? Date.now;
  const brokerLogger = options.logger ?? NOOP_LOGGER;
  let cachedLease: AccessTokenLease | undefined;
  let inFlight:
    | {
        epoch: number;
        promise: Promise<AccessTokenLease>;
      }
    | undefined;
  let epoch = 0;
  let minimumGeneration = 0;
  let admissionOpen = true;
  let disposed = false;
  let server: CredentialLeaseServer | undefined;
  let stopWatching: (() => void) | undefined;

  function invalidate(): void {
    epoch += 1;
    cachedLease = undefined;
  }

  async function loadValidatedLease(
    minValidityMs: number,
    requestEpoch: number,
  ): Promise<AccessTokenLease> {
    const lease = await loadLease(options.session, minValidityMs);
    assertFixedLease(lease);
    if (disposed) throw new CredentialLeaseProtocolError('BROKER_UNAVAILABLE');
    if (requestEpoch !== epoch || !admissionOpen || lease.generation < minimumGeneration) {
      throw new CredentialLeaseProtocolError('AUTH_REQUIRED');
    }
    cachedLease = lease;
    return lease;
  }

  async function acquireLease(minValidityMs: number): Promise<AccessTokenLease> {
    if (disposed) throw new CredentialLeaseProtocolError('BROKER_UNAVAILABLE');
    if (!admissionOpen) throw new CredentialLeaseProtocolError('AUTH_REQUIRED');
    if (
      cachedLease &&
      admissionOpen &&
      cachedLease.generation >= minimumGeneration &&
      isUsableLease(cachedLease, minValidityMs, now())
    ) {
      return cachedLease;
    }

    for (;;) {
      if (inFlight) {
        const lease = await inFlight.promise;
        if (
          admissionOpen &&
          lease.generation >= minimumGeneration &&
          isUsableLease(lease, minValidityMs, now())
        ) {
          return lease;
        }
        continue;
      }

      const requestEpoch = epoch;
      const request = loadValidatedLease(minValidityMs, requestEpoch);
      const current = { epoch: requestEpoch, promise: request };
      inFlight = current;
      try {
        const lease = await request;
        if (
          admissionOpen &&
          lease.generation >= minimumGeneration &&
          isUsableLease(lease, minValidityMs, now())
        ) {
          return lease;
        }
      } finally {
        if (inFlight === current) inFlight = undefined;
      }
    }
  }

  async function handleRequest(request: CredentialLeaseRequest): Promise<CredentialLeaseSuccessResult> {
    if (disposed) throw new CredentialLeaseProtocolError('BROKER_UNAVAILABLE');
    if (request.method === 'status') return await getCredentialFreeStatus(options.session);
    if (request.method === 'lease') {
      const lease = await acquireLease(request.minValidityMs);
      return {
        method: 'lease',
        accessToken: lease.accessToken,
        expiresAtMs: lease.expiresAtMs,
        generation: lease.generation,
        audience: CREDENTIAL_LEASE_AUDIENCE,
        scopes: CREDENTIAL_LEASE_SCOPES,
      };
    }
    invalidate();
    const action = await options.session.handleUnauthorized(request.generation);
    return { method: 'unauthorized', action };
  }

  await writeCapabilityFile(endpoint.capabilityFile, capability);
  try {
    server = await startCredentialLeaseServer({
      endpoint: endpoint.endpoint,
      capability,
      handler: handleRequest,
    });
    stopWatching = options.session.subscribe((status) => {
      minimumGeneration = Math.max(minimumGeneration, status.generation);
      const generationChanged =
        cachedLease !== undefined && cachedLease.generation < minimumGeneration;
      const admissionClosed = status.status !== 'authenticated' && status.status !== 'refreshing';
      admissionOpen = !admissionClosed;
      if (admissionClosed) invalidate();
      else if (generationChanged) cachedLease = undefined;
    });
  } catch (error) {
    await server?.close().catch(() => undefined);
    await rm(endpoint.capabilityFile, { force: true });
    throw error;
  }

  brokerLogger.info(`[credential-lease-broker] ready protocol=${CREDENTIAL_LEASE_PROTOCOL_VERSION}`);

  return {
    endpoint: endpoint.endpoint,
    capabilityFile: endpoint.capabilityFile,
    async dispose(): Promise<void> {
      if (disposed) return;
      disposed = true;
      invalidate();
      stopWatching?.();
      stopWatching = undefined;
      try {
        await server?.close();
      } catch {
        brokerLogger.warn('[credential-lease-broker] dispose transport_error');
      } finally {
        server = undefined;
        await rm(endpoint.capabilityFile, { force: true });
      }
      brokerLogger.info(
        `[credential-lease-broker] disposed protocol=${CREDENTIAL_LEASE_PROTOCOL_VERSION}`,
      );
    },
  };
}

async function getCredentialFreeStatus(
  session: CredentialLeaseSession,
): Promise<CredentialLeaseSuccessResult> {
  const status = await session.getStatus();
  return {
    method: 'status',
    status: status.status,
    generation: status.generation,
    ...(status.expiresAtMs === undefined ? {} : { expiresAtMs: status.expiresAtMs }),
  };
}

async function loadLease(
  session: CredentialLeaseSession,
  minValidityMs: number,
): Promise<AccessTokenLease> {
  try {
    return await session.getAccessToken(minValidityMs);
  } catch (error) {
    const status = await readStatusAfterLeaseFailure(session);
    if (!status || status.status !== 'authenticated') {
      throw new CredentialLeaseProtocolError('AUTH_REQUIRED');
    }
    throw error;
  }
}

async function readStatusAfterLeaseFailure(
  session: CredentialLeaseSession,
): Promise<AuthStatusSnapshot | undefined> {
  try {
    return await session.getStatus();
  } catch {
    return undefined;
  }
}

function isUsableLease(
  lease: AccessTokenLease,
  minValidityMs: number,
  nowMs: number,
): boolean {
  return lease.expiresAtMs - nowMs >= minValidityMs;
}

function assertFixedLease(lease: AccessTokenLease): void {
  if (
    lease.audience !== CREDENTIAL_LEASE_AUDIENCE ||
    lease.scopes.length !== 1 ||
    lease.scopes[0] !== CREDENTIAL_LEASE_SCOPES[0]
  ) {
    throw new CredentialLeaseProtocolError('INTERNAL_ERROR');
  }
}
