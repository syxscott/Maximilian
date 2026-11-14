// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Voice input, oneshot pipeline (chat-demo chatInput/useVoiceInput.ts
 * borrowing): click to record → click again to stop and transcribe →
 * click while transcribing cancels. `operationRef` is the GENERATION
 * TOKEN that makes every stale async branch inert: a cancel during the
 * transcribe await bumps it, so the late result never reaches the
 * composer. Recording auto-stops at the 120s limit.
 *
 * HONEST BOUNDARY: the transcription backend is NOT part of this change —
 * the `transcriber` callback is INJECTED (the dashboard has no speech API
 * endpoint yet). Without an injected transcriber ChatPanel renders no
 * voice button at all; the interface here is the pinned contract.
 *
 * The transcribed text is inserted by the caller at the textarea's
 * current selection (insertComposerText in ChatPanel).
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { useNotificationStore } from "@/stores/notificationStore"

export type VoiceInputStatus = "idle" | "recording" | "transcribing"

/**
 * The pinned transcription seam: receives the recorded audio blob and an
 * abort signal, resolves the recognized text. Injected by the host (App/
 * settings) once a speech backend exists; undefined keeps the entry hidden.
 */
export type VoiceTranscriber = (audio: Blob, signal: AbortSignal) => Promise<string>

/** Recording auto-stop limit (chat-demo recorder parity). */
export const VOICE_INPUT_LIMIT_MS = 120_000

/**
 * Recording availability: getUserMedia requires a secure context (HTTPS,
 * localhost); a plain HTTP page disables the entry up front instead of
 * failing on click. Also requires the MediaRecorder surface (absent in
 * non-browser DOM shells).
 */
export function voiceInputAvailable(): boolean {
  if (typeof window === "undefined") return false
  if (!window.isSecureContext) return false
  if (typeof MediaRecorder !== "function") return false
  const nav = window.navigator
  return nav.mediaDevices !== undefined && typeof nav.mediaDevices.getUserMedia === "function"
}

/**
 * DOMException → user-facing i18n key (chat-demo describeRecordingError
 * borrowing). Exported pure for tests.
 */
export function describeVoiceError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError") {
      return "composer.voice.permissionDenied"
    }
    if (error.name === "NotFoundError") return "composer.voice.noDevice"
  }
  return "composer.voice.failed"
}

/** One active recording; `stop` resolves the audio blob (null if empty). */
interface Recording {
  stop: () => Promise<Blob | null>
  cancel: () => void
}

/** Real MediaRecorder-backed recording (chat-demo recorder.ts parity). */
async function startRecording(onLimit: () => void): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  const recorder = new MediaRecorder(stream)
  const chunks: Blob[] = []
  recorder.ondataavailable = (e: BlobEvent) => {
    if (e.data.size > 0) chunks.push(e.data)
  }
  recorder.start()
  let stopped = false
  let limitTimer: ReturnType<typeof setTimeout> | undefined
  const stopTracks = (): void => {
    for (const track of stream.getTracks()) track.stop()
  }
  const stop = (): Promise<Blob | null> =>
    new Promise<Blob | null>((resolve) => {
      if (limitTimer !== undefined) clearTimeout(limitTimer)
      if (stopped || recorder.state === "inactive") {
        stopTracks()
        resolve(blobFrom(chunks, recorder.mimeType))
        return
      }
      stopped = true
      recorder.onstop = () => {
        stopTracks()
        resolve(blobFrom(chunks, recorder.mimeType))
      }
      recorder.stop()
    })
  const cancel = (): void => {
    if (limitTimer !== undefined) clearTimeout(limitTimer)
    if (recorder.state !== "inactive") recorder.stop()
    stopTracks()
  }
  limitTimer = setTimeout(() => {
    if (!stopped) onLimit()
  }, VOICE_INPUT_LIMIT_MS)
  return { stop, cancel }
}

function blobFrom(chunks: Blob[], mime: string): Blob | null {
  if (chunks.length === 0) return null
  return new Blob(chunks, { type: mime || "audio/webm" })
}

export interface VoiceInputController {
  status: VoiceInputStatus
  /** Seconds recorded in the CURRENT recording (0 outside "recording"). */
  seconds: number
  /** Secure-context + API availability — the button renders disabled when false. */
  available: boolean
  toggle: () => void
  cancel: () => void
}

/**
 * The oneshot voice pipeline. `onText` receives the finalized transcription
 * text (trim + non-empty guarded — an empty transcript surfaces
 * composer.voice.empty instead of writing nothing).
 */
export function useVoiceInput(
  onText: (text: string) => void,
  transcriber: VoiceTranscriber | undefined,
): VoiceInputController {
  const [status, setStatus] = useState<VoiceInputStatus>("idle")
  const [seconds, setSeconds] = useState(0)
  const recordingRef = useRef<Recording | null>(null)
  const controllerRef = useRef<AbortController | null>(null)
  /** Generation token — bumps invalidate every stale async branch. */
  const operationRef = useRef(0)
  const onTextRef = useRef(onText)
  onTextRef.current = onText
  const transcriberRef = useRef(transcriber)
  transcriberRef.current = transcriber
  const available = voiceInputAvailable()

  const cancelOperation = useCallback(() => {
    operationRef.current += 1
    recordingRef.current?.cancel()
    recordingRef.current = null
    controllerRef.current?.abort()
    controllerRef.current = null
  }, [])

  const cancel = useCallback(() => {
    cancelOperation()
    setStatus("idle")
  }, [cancelOperation])

  const finish = useCallback(async () => {
    const recording = recordingRef.current
    if (!recording) {
      // Still waiting on mic permission — cancel is legal; a late recording
      // object is released immediately.
      cancel()
      return
    }
    const operation = operationRef.current
    recordingRef.current = null
    let controller: AbortController | null = null
    try {
      let audio: Blob | null
      try {
        audio = await recording.stop()
      } finally {
        recording.cancel()
      }
      if (operationRef.current !== operation || !audio) return
      const transcribe = transcriberRef.current
      if (transcribe === undefined) return
      controller = new AbortController()
      controllerRef.current = controller
      setStatus("transcribing")
      const text = await transcribe(audio, controller.signal)
      if (controller.signal.aborted || operationRef.current !== operation) {
        // Cancelled mid-transcribe — the generation token ate the result.
        return
      }
      if (text.trim()) {
        onTextRef.current(text.trim())
      } else {
        pushVoiceNotice("composer.voice.empty")
      }
    } catch (error) {
      if (operationRef.current === operation && !controller?.signal.aborted) {
        pushVoiceNotice(describeVoiceError(error))
      }
    } finally {
      if (operationRef.current === operation) {
        controllerRef.current = null
        setStatus("idle")
      }
    }
  }, [cancel])

  const toggle = useCallback(() => {
    if (!available) return
    if (status === "recording") {
      void finish()
      return
    }
    if (status === "transcribing") {
      cancel()
      return
    }
    const operation = ++operationRef.current
    setStatus("recording")
    void startRecording(() => {
      if (operationRef.current === operation) {
        pushVoiceNotice("composer.voice.limitReached")
        void finish()
      }
    })
      .then((recording) => {
        if (operationRef.current !== operation) {
          // A cancel landed while permission was pending — release at once.
          recording.cancel()
          return
        }
        recordingRef.current = recording
      })
      .catch((error: unknown) => {
        if (operationRef.current === operation) {
          setStatus("idle")
          pushVoiceNotice(describeVoiceError(error))
        }
      })
  }, [available, status, finish, cancel])

  useEffect(() => {
    if (status !== "recording") return
    const startedAt = Date.now()
    setSeconds(0)
    // Half-second refresh keeps the displayed seconds honest.
    const timer = setInterval(() => {
      setSeconds(Math.floor((Date.now() - startedAt) / 1000))
    }, 500)
    return () => clearInterval(timer)
  }, [status])

  useEffect(() => cancelOperation, [cancelOperation])

  return { status, seconds, available, toggle, cancel }
}

/** Voice feedback rides the standard notification → ToastHost path. */
function pushVoiceNotice(messageKey: string): void {
  useNotificationStore.getState().push("error", messageKey)
}
