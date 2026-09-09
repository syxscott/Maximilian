/**
 * Size-limit configuration for Maximilian.
 *
 * Written as `.cjs` (not `.json`) because we need `modifyWebpackConfig` —
 * a function that stamps `target: 'node'` and externalizes all `@max/*`
 * workspace packages onto the auto-generated webpack config. size-limit
 * runs that hook after its own defaults are applied, so we keep the
 * bundling machinery (entry, output, asset rules, IgnorePlugin) intact
 * and only layer these two concerns on top.
 *
 * Why these two settings exist:
 *
 *   - `target: 'node'` — every package being measured is a Node.js
 *     server library that uses `node:*` builtin imports (`crypto`,
 *     `fs`, etc). size-limit's default webpack target is the browser,
 *     which rejects `node:` URIs outright. `target: 'node'` makes
 *     webpack treat all node builtins as externals, which is exactly
 *     what we want — we measure the library's authored code, not a
 *     hypothetical browser build that would fail anyway.
 *
 *   - Externalize `@max/*` workspace packages — most of these are
 *     configured with `"main": "./src/index.ts"` rather than a built
 *     dist, so webpack would happily follow them into TypeScript
 *     source and choke on `type` keywords. Workspace packages are
 *     internal implementation; an app consuming `@max/sdk` will
 *     already have `@max/telemetry`, `@max/core`, etc. in its
 *     node_modules. Bundling them again during size measurement
 *     double-counts and breaks compilation, so we mark them external.
 */

const fs = require("node:fs")
const path = require("node:path")

// Discover all `@max/*` workspace packages so we don't have to maintain
// the list by hand whenever a new package lands.
const workspacePackages = fs
  .readdirSync(path.join(__dirname, "packages"), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((dir) => {
    try {
      const pkg = JSON.parse(
        fs.readFileSync(path.join(__dirname, "packages", dir.name, "package.json"), "utf8"),
      )
      return pkg.name
    } catch {
      return null
    }
  })
  .filter((name) => name && name.startsWith("@max/"))

// `modifyWebpackConfig` runs AFTER size-limit generates its base webpack
// config (entry, output, asset rules). We layer the two server-side
// concerns on top so the auto-generated bundling machinery keeps working
// unchanged.
function applyMaximilianWebpackDefaults(config) {
  return {
    ...config,
    target: "node",
    // Treat Maximilian's server packages as ESM externals. We need
    // `externalsType: 'module'` so webpack emits a real `import`
    // statement (matching how a Node ESM consumer would resolve the
    // dependency at runtime) instead of the CJS default which would
    // parse as `const __NS__ = @max/telemetry` and choke on `@`.
    externalsType: "module",
    // `outputModule: true` is required by webpack 5 to pair with
    // `externalsType: 'module'`; otherwise the build aborts before any
    // modules are processed.
    experiments: {
      ...(config?.experiments || {}),
      outputModule: true,
    },
    externals: [
      ({ request }, callback) => {
        // Subpath imports (`@max/tools/permission`) must also be treated as
        // external — without `startsWith` matching here webpack follows the
        // bare subpath into the source `.ts` file and chokes on `type`
        // keywords (see commit history: bundle-size regression after
        // `@max/tools` started exporting subpaths in its `exports` map).
        const isWorkspace =
          request === "react" ||
          request === "react-dom" ||
          workspacePackages.some(
            (pkg) => request === pkg || request.startsWith(`${pkg}/`),
          )
        if (isWorkspace) {
          // Emit `import * as ns from "react"` so the resulting bundle
          // is valid ESM and webpack's module concatenation pass can
          // parse it.
          callback(null, `module ${request}`)
          return
        }
        callback()
      },
      ...(Array.isArray(config?.externals) ? config.externals : []),
    ],
  }
}

module.exports = [
  {
    name: "@max/sdk (ESM)",
    path: "packages/sdk/dist/client.js",
    limit: "15 KB",
    ignore: ["react", "react-dom"],
    modifyWebpackConfig: applyMaximilianWebpackDefaults,
  },
  {
    name: "@max/sdk (ESM, gzipped)",
    path: "packages/sdk/dist/client.js",
    limit: "6 KB",
    ignore: ["react", "react-dom"],
    brotli: false,
    gzip: true,
    modifyWebpackConfig: applyMaximilianWebpackDefaults,
  },
  {
    name: "@max/core (ESM)",
    path: "packages/core/dist/index.js",
    limit: "120 KB",
    modifyWebpackConfig: applyMaximilianWebpackDefaults,
  },
  {
    name: "@max/core (ESM, gzipped)",
    path: "packages/core/dist/index.js",
    limit: "40 KB",
    gzip: true,
    modifyWebpackConfig: applyMaximilianWebpackDefaults,
  },
  {
    name: "@max/agents (ESM)",
    path: "packages/agents/dist/index.js",
    limit: "80 KB",
    modifyWebpackConfig: applyMaximilianWebpackDefaults,
  },
  {
    name: "@max/llm (ESM)",
    path: "packages/llm/dist/index.js",
    limit: "100 KB",
    modifyWebpackConfig: applyMaximilianWebpackDefaults,
  },
  {
    name: "@max/commander (ESM)",
    path: "packages/commander/dist/index.js",
    limit: "60 KB",
    modifyWebpackConfig: applyMaximilianWebpackDefaults,
  },
  {
    name: "@max/queue (ESM)",
    path: "packages/queue/dist/index.js",
    // BullMQ + ioredis are unavoidable third-party deps for a backed-by-Redis
    // queue, and the 50 KB limit on this one was never validated against a
    // real build (queue had no build script until now). Bump to 200 KB
    // — same ballpark as database (drizzle + postgres-js).
    limit: "200 KB",
    modifyWebpackConfig: applyMaximilianWebpackDefaults,
  },
  {
    name: "@max/database (ESM)",
    path: "packages/database/dist/index.js",
    limit: "200 KB",
    modifyWebpackConfig: applyMaximilianWebpackDefaults,
  },
  {
    name: "ui-react bundle (ESM)",
    path: "packages/ui-react/dist/index.js",
    limit: "150 KB",
    modifyWebpackConfig: applyMaximilianWebpackDefaults,
  },
]
