import type { CredentialAuthMachine } from './auth-machine.js';
import type { AccessTokenLease, AuthStatusSnapshot } from './auth-machine.js';

/**
 * Provider-facing token interface, ported from minimax-code's `MCodeTokenProvider`.
 * `handleUnauthorized()` reports the *current* session's lease as rejected; the
 * broker-facing machine method accepts an explicit generation for callers that
 * know which lease they used.
 */
export interface TokenProvider {
  getStatus(): Promise<AuthStatusSnapshot>;
  getAccessToken(options: { minValidityMs: number }): Promise<AccessTokenLease>;
  handleUnauthorized(): Promise<'retry' | 'logout'>;
}

export function createTokenProvider(machine: CredentialAuthMachine): TokenProvider {
  return Object.freeze({
    getStatus: () => machine.getStatus(),
    getAccessToken: (options: { minValidityMs: number }) =>
      machine.getAccessToken(options.minValidityMs),
    handleUnauthorized: () => machine.handleUnauthorized(),
  });
}
