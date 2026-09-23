import path from "node:path"

import {
  CREDENTIAL_LEASE_AUDIENCE,
  CREDENTIAL_LEASE_MAX_MIN_VALIDITY_MS,
  CREDENTIAL_LEASE_SCOPES,
} from "./contracts.js"
import { AuthStateStore, parseAuthState, type AuthState, type AuthStatus } from "./auth-state.js"
import { withFileLock, type FileLockOptions } from "./file-lock.js"

const DEFAULT_LOCK_TIMEOUT_MS = 10_000

/** The generation counter doubles as the login epoch (source: loginEpoch + generation). */
export class AuthRequiredError extends Error {
  readonly code = "AUTH_REQUIRED"

  constructor(options?: ErrorOptions) {
    super("Authentication is required.", options)
    this.name = "AuthRequiredError"
  }
}

export interface AuthStatusSnapshot {
  status: AuthStatus
  generation: number
  expiresAtMs?: number
}

export interface AccessTokenLease {
  accessToken: string
  expiresAtMs: number
  generation: number
  scopes: typeof CREDENTIAL_LEASE_SCOPES
  audience: typeof CREDENTIAL_LEASE_AUDIENCE
}

/** What a provider hands back once its login/refresh dance produced a token. */
export interface LoginGrant {
  accessToken: string
  expiresAtMs: number
}

export interface LoginResult {
  status: "authenticated"
  generation: number
}

export interface LogoutResult {
  status: "anonymous"
  generation: number
}

export interface CredentialAuthMachineOptions {
  /** Directory holding auth-state.json and the cross-process lock file. */
  stateDir: string
  now?: () => number
  /**
   * Optional provider-supplied refresh. Called when a lease lacks the requested
   * validity or the current token was rejected as unauthorized.
   */
  refresh?: () => Promise<LoginGrant>
  lock?: FileLockOptions
}

/**
 * Auth state machine ported (simplified) from minimax-code's `MCodeOAuthCore`:
 * anonymous → authorizing → authenticated → refreshing → … with a monotonic
 * generation counter for login-epoch consistency, subscriber notifications, and
 * atomic JSON persistence of the (secret-free) state.
 *
 * Simplifications vs. the source: no OAuth device-flow client, no pluggable
 * credential store (the access token lives in memory only and is never
 * persisted), no namespaces/domains, no `logout_pending` state, and no
 * AbortController-based login cancellation.
 */
export class CredentialAuthMachine {
  private readonly stateStore: AuthStateStore
  private readonly lockPath: string
  private readonly lockOptions: FileLockOptions
  private readonly now: () => number
  private readonly refreshHook: (() => Promise<LoginGrant>) | undefined
  private readonly listeners = new Set<(snapshot: AuthStatusSnapshot) => void>()
  private state: AuthState = {
    schemaVersion: 1,
    status: "anonymous",
    generation: 0,
    updatedAtMs: 0,
  }
  private accessToken: string | undefined
  private loadedPromise: Promise<void> | undefined
  private loginPromise: Promise<LoginResult> | undefined
  private refreshPromise: Promise<AccessTokenLease> | undefined

  constructor(private readonly options: CredentialAuthMachineOptions) {
    this.stateStore = new AuthStateStore(path.join(options.stateDir, "auth-state.json"))
    this.lockPath = path.join(options.stateDir, "auth.lock")
    this.lockOptions = { timeoutMs: DEFAULT_LOCK_TIMEOUT_MS, ...options.lock }
    this.now = options.now ?? Date.now
    this.refreshHook = options.refresh
  }

  async getStatus(): Promise<AuthStatusSnapshot> {
    await this.initialize()
    return this.snapshot()
  }

  /**
   * Returns an access token if authenticated with at least `minValidityMs` of
   * remaining validity; otherwise attempts a refresh (when configured) or
   * throws AuthRequiredError.
   */
  async getAccessToken(minValidityMs: number): Promise<AccessTokenLease> {
    await this.initialize()
    if (
      !Number.isSafeInteger(minValidityMs) ||
      minValidityMs < 0 ||
      minValidityMs > CREDENTIAL_LEASE_MAX_MIN_VALIDITY_MS
    ) {
      throw new TypeError("minValidityMs must be an integer between 0 and 5 minutes.")
    }
    const usable = this.usableLease(minValidityMs)
    if (usable) return usable
    if (this.refreshHook) {
      const refreshed = await this.refresh()
      if (refreshed.expiresAtMs - this.now() >= minValidityMs) return refreshed
    }
    throw new AuthRequiredError()
  }

  /**
   * Runs the provider login dance exactly once per call generation. Concurrent
   * callers share the in-flight login (single-flight). Generation bumps by one
   * on every successful commit.
   */
  login(perform: () => Promise<LoginGrant>): Promise<LoginResult> {
    if (!this.loginPromise) {
      const promise = this.initialize()
        .then(() => this.runLogin(perform))
        .finally(() => {
          if (this.loginPromise === promise) this.loginPromise = undefined
        })
      this.loginPromise = promise
    }
    return this.loginPromise
  }

  async logout(): Promise<LogoutResult> {
    await this.initialize()
    return withFileLock(
      this.lockPath,
      async () => {
        await this.reloadIfNewer()
        if (this.state.status === "anonymous" && !this.accessToken) {
          return { status: "anonymous" as const, generation: this.state.generation }
        }
        const logoutGeneration = this.state.generation + 1
        await this.transition({ ...this.baseState("logging_out"), generation: logoutGeneration })
        this.accessToken = undefined
        await this.transition({ ...this.baseState("anonymous"), generation: logoutGeneration })
        return { status: "anonymous" as const, generation: logoutGeneration }
      },
      this.lockOptions,
    )
  }

  /**
   * Marks the lease identified by `generation` as rejected. The generation
   * counter is the login epoch: callers from an older epoch are told to retry
   * (a newer login already replaced their session); a newer-than-local epoch is
   * treated as an unrecoverable divergence and forced to logout. The current
   * epoch's token is revoked: refreshed when possible ('retry'), otherwise the
   * session is torn down ('logout').
   */
  async handleUnauthorized(requestedGeneration?: number): Promise<"retry" | "logout"> {
    await this.initialize()
    return withFileLock(
      this.lockPath,
      async () => {
        await this.reloadIfNewer()
        const requested = requestedGeneration ?? this.state.generation
        if (requested < this.state.generation) return "retry"
        if (requested > this.state.generation) {
          // The caller knows a newer login than this process; tear down the
          // diverged local session rather than keep serving its token.
          await this.forceLogout()
          return "logout"
        }
        // Same epoch: the current token was rejected by the resource server.
        this.accessToken = undefined
        if (this.refreshHook) {
          try {
            await this.refresh()
            return "retry"
          } catch {
            await this.forceLogout()
            return "logout"
          }
        }
        await this.forceLogout()
        return "logout"
      },
      this.lockOptions,
    )
  }

  /** Provider hook: the current authorization is missing required scopes. */
  async markScopeUpgradeRequired(): Promise<void> {
    await this.initialize()
    if (this.state.status !== "authenticated" && this.state.status !== "expired") return
    await this.transition({ ...this.state, status: "scope_upgrade_required" })
  }

  subscribe(listener: (snapshot: AuthStatusSnapshot) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Re-reads the persisted state, adopting it when its generation is newer. */
  async loadState(): Promise<AuthStatusSnapshot> {
    await this.initialize()
    await this.reloadIfNewer()
    return this.snapshot()
  }

  /** Persists the current in-memory state atomically (exposed for tooling/tests). */
  async persistState(): Promise<void> {
    await this.initialize()
    await this.stateStore.write(this.state)
  }

  private async initialize(): Promise<void> {
    this.loadedPromise ??= (async () => {
      const persisted = await this.stateStore.read()
      if (persisted) this.state = persisted
    })()
    return this.loadedPromise
  }

  private async runLogin(perform: () => Promise<LoginGrant>): Promise<LoginResult> {
    if (this.usableLease(0)) {
      return { status: "authenticated", generation: this.state.generation }
    }
    // Enter the authorizing epoch UNDER the cross-process lock. Writing it
    // outside the lock (the previous shape) let a concurrent machine's
    // just-committed authenticated state be clobbered back to our older
    // generation — a second login then computed the same generation as the
    // first and the shared epoch regressed ([1,1] instead of [1,2]).
    // The network dance (perform) stays OUTSIDE the lock by design.
    await withFileLock(
      this.lockPath,
      async () => {
        await this.reloadIfNewer()
        await this.transition({ ...this.baseState("authorizing") })
      },
      this.lockOptions,
    )
    try {
      const grant = await perform()
      return await withFileLock(
        this.lockPath,
        async () => {
          await this.reloadIfNewer()
          const generation = this.state.generation + 1
          this.accessToken = grant.accessToken
          await this.transition({
            ...this.baseState("authenticated"),
            generation,
            expiresAtMs: grant.expiresAtMs,
          })
          return { status: "authenticated" as const, generation }
        },
        this.lockOptions,
      )
    } catch (error) {
      // Failure teardown is also locked, and guarded: if another machine
      // committed a newer epoch while we were performing, the disk state is
      // no longer our authorizing epoch and must not be torn down.
      await withFileLock(
        this.lockPath,
        async () => {
          await this.reloadIfNewer()
          if (this.state.status === "authorizing") {
            this.accessToken = undefined
            await this.transition({ ...this.baseState("error") })
          }
        },
        this.lockOptions,
      )
      throw error
    }
  }

  private refresh(): Promise<AccessTokenLease> {
    this.refreshPromise ??= this.runRefresh().finally(() => {
      this.refreshPromise = undefined
    })
    return this.refreshPromise
  }

  private async runRefresh(): Promise<AccessTokenLease> {
    const refreshHook = this.refreshHook
    if (!refreshHook) throw new AuthRequiredError()
    await this.transition({ ...this.state, status: "refreshing" })
    try {
      const grant = await refreshHook()
      const generation = this.state.generation + 1
      this.accessToken = grant.accessToken
      await this.transition({
        ...this.baseState("authenticated"),
        generation,
        expiresAtMs: grant.expiresAtMs,
      })
      return {
        accessToken: grant.accessToken,
        expiresAtMs: grant.expiresAtMs,
        generation,
        scopes: CREDENTIAL_LEASE_SCOPES,
        audience: CREDENTIAL_LEASE_AUDIENCE,
      }
    } catch (error) {
      // Preserve the session identity but force a re-authentication path.
      this.accessToken = undefined
      await this.transition({ ...this.baseState("expired") })
      throw new AuthRequiredError({ cause: error })
    }
  }

  private async forceLogout(): Promise<void> {
    this.accessToken = undefined
    await this.transition({ ...this.baseState("anonymous"), generation: this.state.generation + 1 })
  }

  private usableLease(minValidityMs: number): AccessTokenLease | undefined {
    if (this.derivedStatus() !== "authenticated") return undefined
    if (!this.accessToken || this.state.expiresAtMs === undefined) return undefined
    if (this.state.expiresAtMs - this.now() < minValidityMs) return undefined
    return {
      accessToken: this.accessToken,
      expiresAtMs: this.state.expiresAtMs,
      generation: this.state.generation,
      scopes: CREDENTIAL_LEASE_SCOPES,
      audience: CREDENTIAL_LEASE_AUDIENCE,
    }
  }

  /** 'authenticated' states without a live token report as 'expired' (needs re-auth/refresh). */
  private derivedStatus(): AuthStatus {
    if (this.state.status === "authenticated") {
      if (!this.accessToken || this.state.expiresAtMs === undefined) return "expired"
      if (this.state.expiresAtMs <= this.now()) return "expired"
    }
    return this.state.status
  }

  private snapshot(): AuthStatusSnapshot {
    const status = this.derivedStatus()
    return {
      status,
      generation: this.state.generation,
      ...(this.state.expiresAtMs === undefined ? {} : { expiresAtMs: this.state.expiresAtMs }),
    }
  }

  private baseState(status: AuthStatus): AuthState {
    return {
      schemaVersion: 1,
      status,
      generation: this.state.generation,
      updatedAtMs: this.now(),
    }
  }

  private async transition(state: AuthState): Promise<void> {
    const validated = parseAuthState(state)
    this.state = validated
    await this.stateStore.write(validated)
    this.notify()
  }

  private async reloadIfNewer(): Promise<void> {
    const persisted = await this.stateStore.read()
    if (persisted && persisted.generation > this.state.generation) {
      this.state = persisted
      this.accessToken = undefined
    }
  }

  private notify(): void {
    const snapshot = this.snapshot()
    for (const listener of this.listeners) {
      try {
        listener(snapshot)
      } catch {
        // Listener failures must never break a state transition.
      }
    }
  }
}
