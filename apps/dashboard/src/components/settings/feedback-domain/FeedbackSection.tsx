// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * FeedbackSection — privacy-friendly in-product feedback form, rendered at
 * the bottom of the settings panel.
 *
 * Borrowing: OpenHands `feedback-button.tsx`
 * (OpenHands components/features/feedback/feedback-button.tsx) — optional
 * email, malformed email blocks submit, HTTP failure keeps the draft. Here
 * the destination is an injected transport resolved from
 * VITE_MAXIMILIAN_FEEDBACK_ENDPOINT; when no endpoint is configured the card
 * says so and disables sending instead of faking success.
 *
 * Feedback never consults analytics consent (upstream: submitPrivateFeedback
 * ignores consent), so a denied analytics choice does not block this form.
 */

import { useState, type FormEvent } from "react"
import { useLocale, t } from "@max/i18n"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  submitFeedback,
  type FeedbackSurvey,
  type FeedbackTransport,
} from "@max/telemetry/feedback"
import { resolveDashboardFeedbackTransport } from "./transport"
import {
  FEEDBACK_EMAIL_MAX_LENGTH,
  FEEDBACK_MESSAGE_MAX_LENGTH,
  isValidOptionalEmail,
} from "./model"

/** Build-time resolution; null means the host has no feedback channel. */
const defaultTransport = resolveDashboardFeedbackTransport()

type Status = "idle" | "sending" | "error" | "sent"

export interface FeedbackSectionProps {
  /** Injected transport (tests / self-hosted wiring). Defaults to env config. */
  readonly transport?: FeedbackTransport | null
  /** Optional survey metadata override; defaults to the local prompt. */
  readonly survey?: FeedbackSurvey
}

export function FeedbackSection({
  transport = defaultTransport,
  survey,
}: FeedbackSectionProps = {}) {
  useLocale()
  const [message, setMessage] = useState("")
  const [email, setEmail] = useState("")
  const [emailValid, setEmailValid] = useState(true)
  const [status, setStatus] = useState<Status>("idle")

  const builtInSurvey: FeedbackSurvey = survey ?? {
    id: "dashboard-settings",
    question: t("feedback.question"),
  }
  const configured = transport !== null
  const canSubmit = configured && status !== "sending" && message.trim().length > 0 && emailValid

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canSubmit || !transport) return
    setStatus("sending")
    try {
      await submitFeedback(
        {
          message: message.trim(),
          email,
          source: "dashboard-settings",
          survey: builtInSurvey,
        },
        { transport },
      )
      setMessage("")
      setEmail("")
      setStatus("sent")
    } catch {
      // Draft deliberately preserved: a failed send must not lose the text.
      setStatus("error")
    }
  }

  return (
    <Card data-testid="feedback-section">
      <CardHeader className="py-3 px-4">
        <CardTitle className="text-base text-foreground">{t("feedback.title")}</CardTitle>
      </CardHeader>
      <CardContent className="py-3 px-4 space-y-3">
        <p className="text-sm text-muted-foreground">{t("feedback.description")}</p>
        {!configured && (
          <p
            role="status"
            className="text-sm text-amber-600 dark:text-amber-400"
            data-testid="feedback-unconfigured"
          >
            {t("feedback.unconfigured")}
          </p>
        )}
        {status === "sent" ? (
          <p
            role="status"
            className="text-sm text-emerald-600 dark:text-emerald-400"
            data-testid="feedback-sent"
          >
            {t("feedback.success")}
          </p>
        ) : (
          <form onSubmit={onSubmit} className="space-y-3">
            <div className="space-y-1">
              <label htmlFor="feedback-message" className="text-sm font-medium text-foreground">
                {t("feedback.messageLabel")}{" "}
                <span aria-hidden="true" className="text-destructive">
                  *
                </span>
              </label>
              <Textarea
                id="feedback-message"
                required
                rows={5}
                maxLength={FEEDBACK_MESSAGE_MAX_LENGTH}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                aria-describedby="feedback-submit-hint"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="feedback-email" className="text-sm font-medium text-foreground">
                {t("feedback.emailLabel")}{" "}
                <span className="text-xs text-muted-foreground">{t("feedback.optional")}</span>
              </label>
              <Input
                id="feedback-email"
                type="email"
                autoComplete="email"
                maxLength={FEEDBACK_EMAIL_MAX_LENGTH}
                value={email}
                onChange={(event) => {
                  setEmail(event.currentTarget.value)
                  setEmailValid(isValidOptionalEmail(event.currentTarget.value))
                }}
                aria-describedby="feedback-submit-hint"
              />
            </div>
            <p id="feedback-submit-hint" className="text-xs text-muted-foreground">
              {t("feedback.privacy")}
            </p>
            <p className="text-xs text-muted-foreground">{t("feedback.consentNote")}</p>
            {status === "error" && (
              <p role="alert" className="text-sm text-destructive" data-testid="feedback-error">
                {t("feedback.error")}
              </p>
            )}
            <Button type="submit" disabled={!canSubmit}>
              {status === "sending" ? t("feedback.sending") : t("feedback.send")}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  )
}
