import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";
import { ConfigSchema, type Config } from "./schema.js";
import { cascadeSettings, type SettingsLayer } from "./cascade.js";

// Load .env from cwd and common fallback paths.
// This runs once at import time.
const cwd = process.cwd();
loadDotenv({ path: resolve(cwd, ".env") });
loadDotenv({ path: resolve(cwd, "../../.env") });

let _config: Config | null = null;
let _userLayer: SettingsLayer | undefined;
let _projectLayer: SettingsLayer | undefined;
let _sessionLayer: SettingsLayer | undefined;

/**
 * Returns the validated, frozen config object.
 * Parses process.env once via Zod, then caches the result.
 * Throws on first call if required vars are missing.
 *
 * If any of `registerUserOverride` / `registerProjectOverride` /
 * `registerSessionOverride` were called before this, their values are
 * merged on top of the env-derived config via `cascadeSettings`. Object
 * values recurse; primitives and arrays replace wholesale.
 */
export function getConfig(): Config {
  if (_config) return _config;
  const result = ConfigSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  // Cascade: defaults (env) ← user ← project ← session. Each layer
  // overrides earlier ones; missing layers are skipped.
  const cascaded = cascadeSettings(
    result.data as SettingsLayer,
    _userLayer,
    _projectLayer,
    _sessionLayer,
  ) as unknown as Config
  _config = Object.freeze(cascaded) as Config
  return _config;
}

/**
 * Reset the cached config (for testing).
 */
export function resetConfig(): void {
  _config = null;
  _userLayer = undefined;
  _projectLayer = undefined;
  _sessionLayer = undefined;
}

/**
 * Register a user-level override layer. Must be called BEFORE `getConfig()`
 * (or after `resetConfig()`) — once the config is cached, later overrides
 * are ignored. This mirrors OpenHands' Settings cascade: a more specific
 * layer wins.
 */
export function registerUserOverride(layer: SettingsLayer | undefined): void {
  _userLayer = layer;
}

/** Register a project-level override layer. See `registerUserOverride`. */
export function registerProjectOverride(layer: SettingsLayer | undefined): void {
  _projectLayer = layer;
}

/** Register a session-level override layer. See `registerUserOverride`. */
export function registerSessionOverride(layer: SettingsLayer | undefined): void {
  _sessionLayer = layer;
}

export { ConfigSchema } from "./schema.js";
export type { Config } from "./schema.js";
export * from "./feature-flags.js";
export * from "./cascade.js";
