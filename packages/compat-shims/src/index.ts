/**
 * @max/compat-shims — single source of truth for upstream API drift.
 *
 * Why this package exists:
 *   - When an open-source dependency ships a breaking change (renamed
 *     field, moved import path, dropped function), we update ONE file
 *     here instead of grepping the whole repo.
 *   - Consumers (`packages/providers`, `apps/api`, `apps/tui`) import
 *     the normalized surface and never reach into the upstream SDKs
 *     directly.
 *
 * Public surface (re-export everything for convenience):
 *   - `version.ts`  — detectVersion(), resolveMajor(), featureFlag()
 *   - `ink.ts`      — useInputShim, useAppShim, BoxProps
 *   - `drizzle.ts`  — detectDrizzleCapabilities, driverImportPath, serialColumn
 *   - `hono.ts`     — useHonoApp, toStandardError, StandardErrorBody
 *   - `llm.ts`      — NormalizedChatRequest, toProviderArgs, fromProviderResponse
 *
 * Each submodule is also re-exported under its subpath so consumers can
 * tree-shake: `import { useHonoApp } from "@max/compat-shims/hono"`.
 */

export * from "./version.js";
export * from "./ink.js";
export * from "./drizzle.js";
export * from "./hono.js";
export * from "./llm.js";
