#!/usr/bin/env node
/**
 * TUI entry point.
 *
 * Boots ink, wires up the provider tree, and mounts the App. Mirrors the
 * shape of OpenCode's `index.tsx` (which used Solid + `@opentui/solid`), but
 * adapts to React 19 + ink's `render()` API.
 *
 * Usage:
 *   $ max-tui --prompt "What is this codebase?"
 *
 * The CLI is parsed with `meow` (per the package's dependency list). Common
 * flags:
 *   --prompt <text>   send an initial prompt to the new session
 *   --model <id>      pin a model (provider/model)
 *   --agent <name>    pin an agent
 *   --continue        continue the last session
 *   --url <url>       override the server URL (default: http://localhost:3001)
 *   --directory <dir> override the working directory
 *   --token <token>   set the ADMIN_TOKEN / JWT bearer for protected endpoints
 *
 * All other flags are reserved for future use.
 */

import { render } from "ink"
import meow from "meow"

import App, { run as runApp, type TuiInput } from "./app"
import { TUI_CONFIG_DEFAULT, type Args, type PluginHost } from "./context"

const cli = meow(
  `
  Usage
    $ max-tui [flags]

  Options
    --prompt <text>    Initial prompt to send to a new session
    --model <id>       Pin a model (provider/model)
    --agent <name>     Pin an agent
    --continue         Continue the last session
    --url <url>        Override the server URL (default: http://localhost:3001)
    --directory <dir>  Override the working directory
    --token <token>   Bearer token for ADMIN_TOKEN / JWT protected endpoints
    --help             Show this help
`,
  {
    importMeta: import.meta,
    flags: {
      prompt: { type: "string" },
      model: { type: "string" },
      agent: { type: "string" },
      continue: { type: "boolean", default: false },
      url: { type: "string", default: process.env.MAX_TUI_URL ?? "http://localhost:3001" },
      directory: { type: "string" },
      token: {
        type: "string",
        default: process.env.MAX_TUI_TOKEN ?? process.env.ADMIN_TOKEN ?? "",
      },
    },
  },
)

const args: Args = {
  prompt: cli.flags.prompt,
  model: cli.flags.model,
  agent: cli.flags.agent,
  continue: cli.flags.continue,
}

const noopPluginHost: PluginHost = {
  async start() {
    /* no plugins in this build */
  },
  async dispose() {
    /* nothing to release */
  },
}

// The --continue flag needs the most recent execution id from the API;
// we resolve it inside the App component (which already has the SDK
// client and the right provider stack), so this entry point just packages
// the parsed flags. The App's CLI flag wiring effect takes care of the
// rest.
const input: TuiInput = {
  args,
  config: TUI_CONFIG_DEFAULT,
  url: cli.flags.url,
  directory: cli.flags.directory,
  token: cli.flags.token,
  pluginHost: noopPluginHost,
}

// Delegate to `app.tsx`'s `run()` (mirrors OpenCode's Effect-based lifecycle)
// which spins up the provider tree, mounts the routes, and tears down on exit.
// `run` is async so callers can `await` it; we just kick it off here.
void runApp(input)

// Keep `App` and `render` referenced so future entry-point rewrites that
// inline-mount can reuse them without re-importing.
void App
void render
void input
