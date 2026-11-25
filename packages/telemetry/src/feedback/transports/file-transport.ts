// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * File transport — the honest in-host consumer.
 *
 * Borrowing shape from Maximilian's own TelemetryCollector JSONL persistence
 * (packages/telemetry/src/collector.ts): one JSON object per line, directory
 * created on demand, write failures isolated so a later submission can still
 * succeed. Path comes from MAXIMILIAN_FEEDBACK_PATH; when it is unset the
 * resolver returns null so callers can show an explicit "not configured"
 * state instead of silently dropping feedback.
 */

import { appendFile, mkdir } from "node:fs/promises"
import { dirname } from "node:path"
import {
  FeedbackChannelNotConfiguredError,
  type FeedbackDelivery,
  type FeedbackPayload,
  type FeedbackTransport,
} from "../types.js"

/** Env var holding the JSONL feedback sink path. */
export const FEEDBACK_PATH_ENV = "MAXIMILIAN_FEEDBACK_PATH"

export class FileFeedbackTransport implements FeedbackTransport {
  readonly name = "file"

  private readonly filePath: string
  /** Serializes concurrent writes; a failure never poisons the chain. */
  private chain: Promise<unknown> = Promise.resolve()

  constructor(filePath: string) {
    if (!filePath.trim()) {
      throw new FeedbackChannelNotConfiguredError(
        `Feedback channel is not configured: ${FEEDBACK_PATH_ENV} is empty`,
      )
    }
    this.filePath = filePath
  }

  /**
   * Append one JSONL record. The returned delivery reflects this write only;
   * earlier failures are swallowed into the chain guard so they cannot block
   * the next submission.
   */
  deliver(payload: FeedbackPayload): Promise<FeedbackDelivery> {
    const line = `${JSON.stringify(payload)}\n`
    const run = this.chain.then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true })
      await appendFile(this.filePath, line, "utf8")
    })
    this.chain = run.catch(() => undefined)
    return run.then(
      () => ({ ok: true }) as FeedbackDelivery,
      (): FeedbackDelivery => ({ ok: false, reason: "io-error" }),
    )
  }

  /** Await all pending writes (tests / graceful shutdown). */
  async flush(): Promise<void> {
    await this.chain
  }
}

/**
 * Resolve the default host transport from the environment. Returns null when
 * MAXIMILIAN_FEEDBACK_PATH is unset/blank — no implicit sink, no silent drop.
 */
export function resolveFileFeedbackTransport(
  env: NodeJS.ProcessEnv = process.env,
): FileFeedbackTransport | null {
  const filePath = env[FEEDBACK_PATH_ENV]?.trim()
  return filePath ? new FileFeedbackTransport(filePath) : null
}
