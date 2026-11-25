// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Dashboard-side transport resolution.
 *
 * The submission service takes an injected transport (packages/telemetry
 * feedback). A browser cannot write MAXIMILIAN_FEEDBACK_PATH directly, so the
 * dashboard's real destination is a self-hosted endpoint configured at build
 * time. When it is absent we return null and the UI says the feedback
 * channel is not configured — never a silent fake success.
 */

import { FetchFeedbackTransport, type FeedbackTransport } from "@max/telemetry/feedback"

/** Build-time endpoint override (self-hosted deployments). */
export const FEEDBACK_ENDPOINT_ENV = "VITE_MAXIMILIAN_FEEDBACK_ENDPOINT"

export function resolveDashboardFeedbackTransport(
  env: Record<string, string | undefined> = import.meta.env,
): FeedbackTransport | null {
  const endpoint = env[FEEDBACK_ENDPOINT_ENV]?.trim()
  if (!endpoint) return null
  return new FetchFeedbackTransport({ endpoint })
}
