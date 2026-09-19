import path from 'node:path';

import { CredentialLeaseProtocolError } from './contracts.js';

const SOCKET_FILE = 'credential-lease-v1.sock';
const CAPABILITY_FILE = 'credential-lease-v1.cap';

export interface CredentialLeaseEndpoint {
  transport: 'unix';
  endpoint: string;
  capabilityFile: string;
}

/**
 * Derives the lease socket and capability-file paths from a state directory:
 * `<stateDir>/run/credential-lease-v1.sock` and `<stateDir>/run/credential-lease-v1.cap`.
 * Unix sockets only — the source protocol also supports Windows named pipes, which
 * this port drops because Maximilian targets Unix-like hosts.
 */
export function resolveCredentialLeaseEndpoint(stateDir: string): CredentialLeaseEndpoint {
  if (process.platform === 'win32') {
    throw new TypeError('Credential lease requires Unix sockets.');
  }
  if (!path.isAbsolute(stateDir)) {
    throw new TypeError('Credential lease stateDir must be absolute.');
  }
  const canonical = trimTrailingSeparators(path.normalize(stateDir));
  return {
    transport: 'unix',
    endpoint: path.join(canonical, 'run', SOCKET_FILE),
    capabilityFile: path.join(canonical, 'run', CAPABILITY_FILE),
  };
}

export function assertCredentialLeaseClientEndpoint(
  endpoint: string,
  capabilityFile: string,
): void {
  if (
    !path.isAbsolute(endpoint) ||
    !path.isAbsolute(capabilityFile) ||
    path.basename(endpoint) !== SOCKET_FILE ||
    path.basename(capabilityFile) !== CAPABILITY_FILE
  ) {
    throw new CredentialLeaseProtocolError('INVALID_REQUEST');
  }
  if (path.dirname(endpoint) !== path.dirname(capabilityFile)) {
    throw new TypeError('Credential lease endpoint and capability file must share one run directory.');
  }
}

function trimTrailingSeparators(value: string): string {
  const root = path.parse(value).root;
  if (value === root) return value;
  return value.replace(/[/]+$/u, '');
}
