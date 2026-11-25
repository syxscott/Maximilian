// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * @max/telemetry feedback — privacy-friendly in-product feedback loop.
 *
 * Browser-safe public surface (no node: imports): payload construction,
 * submission service, injectable fetch transport, and survey providers.
 * The file transport lives in `./transports/file-transport.js` and is
 * re-exported from the package root for Node hosts.
 */

export {
  FeedbackChannelNotConfiguredError,
  FeedbackSubmissionError,
  type FeedbackDelivery,
  type FeedbackInput,
  type FeedbackPayload,
  type FeedbackPayloadProperties,
  type FeedbackSurvey,
  type FeedbackSurveyQuestion,
  type FeedbackTransport,
} from "./types.js"

export { randomUuid } from "./uuid.js"
export { buildFeedbackPayload, normalizeContactEmail } from "./payload.js"
export {
  CachingFeedbackSurveyProvider,
  PostHogFeedbackSurveyProvider,
  StaticFeedbackSurveyProvider,
  type FeedbackSurveyProvider,
  type PostHogSurveyProviderOptions,
} from "./survey.js"
export { submitFeedback, type SubmitFeedbackOptions } from "./submit.js"
export {
  FetchFeedbackTransport,
  type FetchFeedbackTransportOptions,
} from "./transports/fetch-transport.js"
