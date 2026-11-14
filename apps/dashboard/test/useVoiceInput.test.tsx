// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Voice-input oneshot pipeline tests (mocked MediaRecorder + transcriber):
 * the full record→stop→transcribe→insert cycle, the GENERATION TOKEN
 * cancel (a cancelled transcription never writes text), the 120s limit,
 * the secure-context gate, and the DOMException → message-key mapping.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest"
import { render, screen, cleanup, fireEvent, act, waitFor } from "@testing-library/react"
import { getDictionary, setLocale } from "@max/i18n"
import { applyDashboardDictionaries } from "../src/locales/index"
import {
  useVoiceInput,
  voiceInputAvailable,
  describeVoiceError,
  VOICE_INPUT_LIMIT_MS,
  type VoiceTranscriber,
} from "../src/hooks/useVoiceInput"
import { useNotificationStore } from "../src/stores/notificationStore"

applyDashboardDictionaries(getDictionary("zh-CN") ?? {}, getDictionary("en-US") ?? {})
setLocale("en-US")

// ── Browser surface mocks ───────────────────────────────────────────────────

class MockMediaRecorder {
  static instances: MockMediaRecorder[] = []
  state = "inactive"
  mimeType = "audio/webm"
  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  stream: MediaStream
  constructor(stream: MediaStream) {
    this.stream = stream
    MockMediaRecorder.instances.push(this)
  }
  start(): void {
    this.state = "recording"
    // A real recorder emits audio chunks while recording — simulate one
    // captured chunk so stop() resolves a non-empty blob.
    this.ondataavailable?.({ data: new Blob(["audio-bytes"]) })
  }
  stop(): void {
    this.state = "inactive"
    this.onstop?.()
  }
}

const mockTrack = { stop: vi.fn() }
const mockStream = { getTracks: () => [mockTrack] } as unknown as MediaStream

beforeEach(() => {
  writtenTexts.length = 0
  MockMediaRecorder.instances = []
  Object.defineProperty(globalThis, "MediaRecorder", {
    value: MockMediaRecorder,
    configurable: true,
  })
  Object.defineProperty(globalThis.window, "isSecureContext", {
    value: true,
    configurable: true,
  })
  Object.defineProperty(globalThis.navigator, "mediaDevices", {
    value: { getUserMedia: vi.fn().mockResolvedValue(mockStream) },
    configurable: true,
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  useNotificationStore.getState().clear()
})

// ── Harness ─────────────────────────────────────────────────────────────────

const writtenTexts: string[] = []

function Harness({ transcriber }: { transcriber?: VoiceTranscriber }) {
  const voice = useVoiceInput((text) => writtenTexts.push(text), transcriber)
  return (
    <span>
      <button
        type="button"
        data-testid="voice-button"
        data-status={voice.status}
        onClick={() => voice.toggle()}
      >
        mic
      </button>
      <span data-testid="voice-available">{String(voice.available)}</span>
    </span>
  )
}

const click = async (el: HTMLElement): Promise<void> =>
  act(async () => {
    fireEvent.click(el)
    await Promise.resolve()
  })

describe("voice pipeline happy path", () => {
  it("records, stops, transcribes and delivers the text once", async () => {
    const transcriber = vi.fn().mockResolvedValue("  hello from the mic  ")
    const { getByTestId } = render(<Harness transcriber={transcriber} />)
    const button = getByTestId("voice-button")
    expect(getByTestId("voice-available")).toHaveTextContent("true")

    await click(button)
    expect(button).toHaveAttribute("data-status", "recording")
    expect(MockMediaRecorder.instances).toHaveLength(1)
    expect(MockMediaRecorder.instances[0]?.state).toBe("recording")

    await click(button)
    // Recording stopped → transcribing → transcriber called with the blob.
    expect(MockMediaRecorder.instances[0]?.state).toBe("inactive")
    expect(mockTrack.stop).toHaveBeenCalled()
    await waitFor(() => expect(button).toHaveAttribute("data-status", "idle"))
    expect(transcriber).toHaveBeenCalledTimes(1)
    expect(transcriber.mock.calls[0]?.[0]).toBeInstanceOf(Blob)
    // Trimmed, written exactly once.
    expect(writtenTexts).toEqual(["hello from the mic"])
  })
})

describe("generation token — cancel paths", () => {
  it("a cancel during transcription prevents the late text from being written", async () => {
    let resolveTranscribe: ((text: string) => void) | undefined
    const transcriber = vi.fn().mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolveTranscribe = resolve
        }),
    )
    const { getByTestId } = render(<Harness transcriber={transcriber} />)
    const button = getByTestId("voice-button")
    await click(button) // → recording
    await click(button) // → transcribing (awaiting)
    expect(button).toHaveAttribute("data-status", "transcribing")

    await click(button) // cancel → generation token bumps
    expect(button).toHaveAttribute("data-status", "idle")

    // The transcriber promise resolves LATE — its text must NEVER land.
    act(() => {
      resolveTranscribe?.("stale words")
    })
    await waitFor(() => expect(transcriber).toHaveBeenCalledTimes(1))
    expect(writtenTexts).toEqual([])
    expect(button).toHaveAttribute("data-status", "idle")
  })

  it("a cancel while waiting for mic permission releases the late recording", async () => {
    let resolveGetUserMedia: ((stream: MediaStream) => void) | undefined
    Object.defineProperty(globalThis.navigator, "mediaDevices", {
      value: {
        getUserMedia: vi
          .fn()
          .mockImplementation(
            () => new Promise<MediaStream>((resolve) => (resolveGetUserMedia = resolve)),
          ),
      },
      configurable: true,
    })
    const transcriber = vi.fn()
    const { getByTestId } = render(<Harness transcriber={transcriber} />)
    const button = getByTestId("voice-button")
    await click(button) // → recording (permission pending)
    await click(button) // cancel while permission pending
    expect(button).toHaveAttribute("data-status", "idle")
    act(() => {
      resolveGetUserMedia?.(mockStream)
    })
    await act(async () => {
      await Promise.resolve()
    })
    // The late recorder is cancelled immediately — transcriber never runs.
    expect(MockMediaRecorder.instances[0]?.state).toBe("inactive")
    expect(transcriber).not.toHaveBeenCalled()
  })
})

describe("120s limit", () => {
  it("auto-stops the recording and reports the limit", async () => {
    vi.useFakeTimers()
    try {
      const transcriber = vi.fn().mockResolvedValue("auto")
      const { getByTestId } = render(<Harness transcriber={transcriber} />)
      const button = getByTestId("voice-button")
      await click(button)
      expect(button).toHaveAttribute("data-status", "recording")
      await act(async () => {
        vi.advanceTimersByTime(VOICE_INPUT_LIMIT_MS + 1)
        await Promise.resolve()
      })
      // Recording stopped by the limit; a notification was pushed.
      expect(MockMediaRecorder.instances[0]?.state).toBe("inactive")
      expect(
        useNotificationStore
          .getState()
          .items.some((n) => n.messageKey === "composer.voice.limitReached"),
      ).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("secure-context + API gates", () => {
  it("voiceInputAvailable is false without a secure context or MediaRecorder", () => {
    expect(voiceInputAvailable()).toBe(true)
    Object.defineProperty(globalThis.window, "isSecureContext", {
      value: false,
      configurable: true,
    })
    expect(voiceInputAvailable()).toBe(false)
    Object.defineProperty(globalThis.window, "isSecureContext", { value: true, configurable: true })
    Object.defineProperty(globalThis, "MediaRecorder", { value: undefined, configurable: true })
    expect(voiceInputAvailable()).toBe(false)
  })

  it("an unavailable voice entry ignores toggles", async () => {
    Object.defineProperty(globalThis.window, "isSecureContext", {
      value: false,
      configurable: true,
    })
    const transcriber = vi.fn().mockResolvedValue("never")
    const { getByTestId } = render(<Harness transcriber={transcriber} />)
    expect(getByTestId("voice-available")).toHaveTextContent("false")
    await click(getByTestId("voice-button"))
    expect(getByTestId("voice-button")).toHaveAttribute("data-status", "idle")
    expect(transcriber).not.toHaveBeenCalled()
    Object.defineProperty(globalThis.window, "isSecureContext", { value: true, configurable: true })
  })
})

describe("error branches", () => {
  it("maps DOMException names to message keys", () => {
    expect(describeVoiceError(new DOMException("denied", "NotAllowedError"))).toBe(
      "composer.voice.permissionDenied",
    )
    expect(describeVoiceError(new DOMException("sec", "SecurityError"))).toBe(
      "composer.voice.permissionDenied",
    )
    expect(describeVoiceError(new DOMException("none", "NotFoundError"))).toBe(
      "composer.voice.noDevice",
    )
    expect(describeVoiceError(new TypeError("odd"))).toBe("composer.voice.failed")
    expect(describeVoiceError(undefined)).toBe("composer.voice.failed")
  })

  it("a permission-denied mic surfaces the localized notice and stays idle", async () => {
    Object.defineProperty(globalThis.navigator, "mediaDevices", {
      value: {
        getUserMedia: vi.fn().mockRejectedValue(new DOMException("denied", "NotAllowedError")),
      },
      configurable: true,
    })
    const { getByTestId } = render(<Harness transcriber={vi.fn()} />)
    await click(getByTestId("voice-button"))
    await waitFor(() => expect(getByTestId("voice-button")).toHaveAttribute("data-status", "idle"))
    expect(
      useNotificationStore
        .getState()
        .items.some((n) => n.messageKey === "composer.voice.permissionDenied"),
    ).toBe(true)
  })

  it("a failed transcription surfaces the generic failure notice", async () => {
    const transcriber = vi.fn().mockRejectedValue(new Error("backend down"))
    const { getByTestId } = render(<Harness transcriber={transcriber} />)
    const button = getByTestId("voice-button")
    await click(button)
    await click(button)
    await waitFor(() => expect(button).toHaveAttribute("data-status", "idle"))
    expect(
      useNotificationStore.getState().items.some((n) => n.messageKey === "composer.voice.failed"),
    ).toBe(true)
    expect(writtenTexts).toEqual([])
  })

  it("an empty transcript surfaces the empty notice instead of writing nothing", async () => {
    const transcriber = vi.fn().mockResolvedValue("   ")
    const { getByTestId } = render(<Harness transcriber={transcriber} />)
    const button = getByTestId("voice-button")
    await click(button)
    await click(button)
    await waitFor(() => expect(button).toHaveAttribute("data-status", "idle"))
    expect(
      useNotificationStore.getState().items.some((n) => n.messageKey === "composer.voice.empty"),
    ).toBe(true)
    expect(writtenTexts).toEqual([])
  })
})
