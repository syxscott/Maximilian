// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Survey metadata providers.
 *
 * Borrowing: OpenHands `getFeedbackSurveyQuestion`
 * (OpenHands src/services/telemetry.ts:884-949) resolves the survey prompt
 * once and caches it keyed by host/apiKey/surveyId, but never caches a
 * failure. Here the same contract is generalized: a provider loads survey
 * metadata, `CachingFeedbackSurveyProvider` reuses a successful result and
 * lets failures retry on the next submission.
 */

import type { FeedbackSurvey } from "./types.js"

/** Loads survey metadata for a submission. */
export interface FeedbackSurveyProvider {
  load(): Promise<FeedbackSurvey>
}

/** Provider over a fixed, already-known survey. */
export class StaticFeedbackSurveyProvider implements FeedbackSurveyProvider {
  constructor(private readonly survey: FeedbackSurvey) {}

  async load(): Promise<FeedbackSurvey> {
    return this.survey
  }
}

/**
 * Reuses the last successful survey; a rejected `load()` is never cached so
 * the next submission retries instead of sticking to a stale/absent prompt.
 * One instance is meant for one survey configuration.
 */
export class CachingFeedbackSurveyProvider implements FeedbackSurveyProvider {
  private cached: FeedbackSurvey | null = null

  constructor(private readonly inner: FeedbackSurveyProvider) {}

  async load(): Promise<FeedbackSurvey> {
    if (this.cached) return this.cached
    const survey = await this.inner.load()
    this.cached = survey
    return survey
  }
}

export interface PostHogSurveyProviderOptions {
  /** Capture host, e.g. https://us.posthog.com (no trailing slash needed). */
  readonly host: string
  /** Project API key (token). */
  readonly apiKey: string
  /** Survey id to resolve. */
  readonly surveyId: string
  /** Injectable fetch for tests / non-browser hosts. */
  readonly fetchImpl?: typeof fetch
}

/**
 * Resolves a survey prompt from PostHog's public surveys endpoint.
 *
 * Borrowing: OpenHands `getFeedbackSurveyQuestion` (same file) — find the
 * configured survey, require exactly one question. This provider is for
 * self-hosted deployments that run PostHog; the default Maximilian
 * deployment has no PostHog and uses the static/local prompt instead.
 * Caching is layered on via `withCachedSurvey`.
 */
export class PostHogFeedbackSurveyProvider implements FeedbackSurveyProvider {
  private readonly host: string
  private readonly fetchImpl: typeof fetch

  constructor(private readonly options: PostHogSurveyProviderOptions) {
    this.host = options.host.replace(/\/+$/, "")
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch
  }

  async load(): Promise<FeedbackSurvey> {
    const url = `${this.host}/api/surveys/?token=${encodeURIComponent(this.options.apiKey)}`
    const response = await this.fetchImpl(url, {
      credentials: "omit",
      referrerPolicy: "no-referrer",
    })
    if (!response.ok) throw new Error("Feedback survey unavailable")

    const data = (await response.json()) as {
      surveys?: Array<{
        id?: string
        questions?: Array<{ id?: string; question?: string }>
      }>
    }
    const survey = data.surveys?.find((item) => item.id === this.options.surveyId)
    const question = survey?.questions?.[0]
    if (survey?.questions?.length !== 1 || !question?.id || !question.question) {
      throw new Error("Feedback survey unavailable")
    }

    return { id: question.id, question: question.question }
  }
}
