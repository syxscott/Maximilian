// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * VoiceButton — the composer's voice-input affordance (chat-demo
 * VoiceButton.tsx borrowing, simplified): click starts recording, click
 * again stops + transcribes, click during transcription cancels. The
 * recording state is a simple pulse (chat-demo Spectrum is optional
 * flair, deliberately not ported). The button only mounts when a
 * transcriber was injected — useVoiceInput's honest boundary.
 */
import { Mic, Square } from "lucide-react"
import { useLocale, t } from "@max/i18n"
import { cn } from "@/lib/utils"
import type { VoiceInputController } from "@/hooks/useVoiceInput"

export function VoiceButton({
  voice,
  className,
}: {
  /** Controller from useVoiceInput (already bound to an insert callback). */
  voice: VoiceInputController
  className?: string
}) {
  useLocale()
  const recording = voice.status === "recording"
  const transcribing = voice.status === "transcribing"
  const label = !voice.available
    ? t("composer.voice.requiresHttps")
    : recording
      ? t("composer.voice.stop")
      : transcribing
        ? t("composer.voice.cancel")
        : t("composer.voice.start")
  return (
    <span className="inline-flex items-center gap-1.5">
      {recording && (
        <span className="text-[10px] tabular-nums text-muted-foreground" data-testid="voice-timer">
          {t("composer.voice.timer", { seconds: voice.seconds })}
        </span>
      )}
      <button
        type="button"
        className={cn(
          "flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40",
          recording &&
            "bg-destructive/10 text-destructive hover:bg-destructive/20 hover:text-destructive",
          className,
        )}
        aria-label={label}
        aria-pressed={recording}
        aria-disabled={!voice.available}
        title={label}
        disabled={!voice.available}
        data-testid="voice-button"
        data-status={voice.status}
        onClick={() => voice.toggle()}
      >
        {recording ? (
          // Pulse: a breathing ring + filled square (stop) — no analyser.
          <span className="relative flex h-4 w-4 items-center justify-center">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive/40" />
            <Square className="h-3 w-3 fill-current" />
          </span>
        ) : transcribing ? (
          <span
            className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
            aria-hidden="true"
          />
        ) : (
          <Mic className="h-3.5 w-3.5" />
        )}
      </button>
    </span>
  )
}
