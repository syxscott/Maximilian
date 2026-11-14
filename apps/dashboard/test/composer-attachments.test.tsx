// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Composer attachment intake tests: jsdom dragenter/leave SEQUENCES
 * (depth counting must land on zero), directory detection, the in-app
 * token drag routing (misroute-proof) and the document-level paste router
 * (focused composer wins; hidden/inert composers are never addressed).
 */

import { describe, it, expect, vi, afterEach, beforeAll } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { act, useRef } from "react"
import { getDictionary, setLocale } from "@max/i18n"
import { applyDashboardDictionaries } from "../src/locales/index"

// Register the dashboard domain dictionaries (incl. the composer domain)
// exactly like main.tsx does — setup.ts pins the locale to en-US.
applyDashboardDictionaries(getDictionary("zh-CN") ?? {}, getDictionary("en-US") ?? {})
setLocale("en-US")
import {
  useDropIntake,
  COMPOSER_DRAG_TOKEN,
  type UseDropIntakeOptions,
} from "../src/components/composer/useDropIntake"
import { useAttachmentStaging } from "../src/components/composer/useAttachmentStaging"
import {
  beginAppFileDrag,
  endAppFileDrag,
  droppedDirectories,
  clipboardFiles,
  isAddressableComposerCard,
} from "../src/components/composer/attachments"
import { DropOverlay } from "../src/components/composer/DropOverlay"
import { AttachmentRail } from "../src/components/composer/AttachmentRail"

afterEach(() => {
  cleanup()
  endAppFileDrag("")
  vi.restoreAllMocks()
})

// jsdom has no object-URL implementation — stage previews get a stub.
beforeAll(() => {
  Object.defineProperty(globalThis.URL, "createObjectURL", {
    value: vi.fn(() => "blob:staged-preview"),
    configurable: true,
  })
  Object.defineProperty(globalThis.URL, "revokeObjectURL", {
    value: vi.fn(),
    configurable: true,
  })
})

/** Minimal jsdom DataTransfer stand-in (no DragEvent/DataTransfer ctor). */
function fakeTransfer(over: {
  types?: string[]
  files?: File[]
  items?: Array<{ kind: string; getAsFile: () => File | null; webkitGetAsEntry?: () => unknown }>
  token?: string
}): DataTransfer {
  const types = over.types ?? (over.files ? ["Files"] : [])
  if (over.token !== undefined) types.push(COMPOSER_DRAG_TOKEN)
  return {
    types,
    files: over.files ?? [],
    items:
      over.items ?? (over.files ?? []).map((file) => ({ kind: "file", getAsFile: () => file })),
    ...(over.token !== undefined ? { getData: () => over.token } : {}),
    dropEffect: "none",
  } as unknown as DataTransfer
}

function dragEvent(
  type: string,
  dataTransfer: DataTransfer,
  target: Element = document.body,
): DragEvent {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, "dataTransfer", { value: dataTransfer })
  Object.defineProperty(event, "target", { value: target })
  Object.defineProperty(event, "clientX", { value: 10 })
  Object.defineProperty(event, "clientY", { value: 10 })
  return event as unknown as DragEvent
}

const makeFile = (name = "a.png", type = "image/png"): File => new File(["x"], name, { type })

/** Document dispatch flushed through React's act (state updates apply). */
function dispatchAct(event: Event): void {
  act(() => {
    document.dispatchEvent(event)
  })
}

/** Harness exposing the intake calls + overlay state (ChatPanel wiring). */
function Harness(props: Partial<UseDropIntakeOptions> & { cardProps?: Record<string, string> }) {
  const cardRef = useRef<HTMLDivElement | null>(null)
  const staging = useAttachmentStaging()
  const intakeCalls: Array<{ files: File[]; directories: string[] }> = []
  const { dragActive } = useDropIntake({
    cardRef,
    onAddFiles: (files, directories) => {
      intakeCalls.push({ files, directories: [...directories].map((d) => d.name) })
      staging.addFiles(files, directories)
    },
    ...props,
  })
  return (
    <div ref={cardRef} data-composer-card="" data-testid="composer-card" {...props.cardProps}>
      <DropOverlay open={dragActive} />
      <AttachmentRail
        attachments={staging.attachments}
        directories={staging.directoryNames}
        onRemove={staging.remove}
      />
    </div>
  )
}

describe("attachment drop intake — depth counting", () => {
  it("stays active across nested dragenter/leave and resets when depth returns to zero", () => {
    render(<Harness />)
    const transfer = fakeTransfer({ files: [makeFile()] })
    const overlay = () => document.querySelector("[data-testid=drop-overlay]")
    // depth 1 → overlay on
    dispatchAct(dragEvent("dragenter", transfer))
    expect(overlay()).not.toBeNull()
    // nested enter (child boundary) — depth 2
    dispatchAct(dragEvent("dragenter", transfer))
    // leaving one nested level — depth 1, still active
    dispatchAct(dragEvent("dragleave", transfer))
    expect(overlay()).not.toBeNull()
    // final leave — depth 0 → overlay off
    dispatchAct(dragEvent("dragleave", transfer))
    expect(overlay()).toBeNull()
  })

  it("ignores drags without a Files payload", () => {
    render(<Harness />)
    dispatchAct(dragEvent("dragenter", fakeTransfer({ types: ["text/plain"] })))
    dispatchAct(dragEvent("dragenter", fakeTransfer({ types: ["text/plain"] })))
    expect(document.querySelector("[data-testid=drop-overlay]")).toBeNull()
  })

  it("resets on drop and stages the dropped files", () => {
    const { getByTestId } = render(<Harness />)
    const file = makeFile("note.txt", "text/plain")
    const card = getByTestId("composer-card")
    dispatchAct(dragEvent("dragenter", fakeTransfer({ files: [file] })))
    dispatchAct(dragEvent("drop", fakeTransfer({ files: [file] }), card))
    expect(document.querySelector("[data-testid=drop-overlay]")).toBeNull()
    expect(screen.getByTestId("attachment-card")).toHaveTextContent("note.txt")
    // dropEffect copy while intake enabled
    const transfer = fakeTransfer({ files: [file] })
    dispatchAct(dragEvent("dragover", transfer))
    expect(transfer.dropEffect).toBe("copy")
  })

  it("reports directory members via webkitGetAsEntry and shows the honest notice", () => {
    const file = makeFile("real.txt", "text/plain")
    const entry = { isDirectory: true }
    const render1 = render(<Harness />)
    const card = render1.getByTestId("composer-card")
    dispatchAct(
      dragEvent(
        "drop",
        fakeTransfer({
          files: [file],
          items: [{ kind: "file", getAsFile: () => file, webkitGetAsEntry: () => entry }],
        }),
        card,
      ),
    )
    expect(screen.getByTestId("attachment-directories-notice")).toHaveTextContent("real.txt")
  })
})

describe("in-app token drag routing", () => {
  it("never shows the fullscreen overlay for a token drag", () => {
    render(<Harness />)
    const transfer = fakeTransfer({ token: "att-1" })
    dispatchAct(dragEvent("dragenter", transfer))
    dispatchAct(dragEvent("dragenter", transfer))
    expect(document.querySelector("[data-testid=drop-overlay]")).toBeNull()
    dispatchAct(dragEvent("dragleave", transfer))
    dispatchAct(dragEvent("dragleave", transfer))
  })

  it("intakes the retained File ONLY over a composer card (misroute-proof)", () => {
    const file = makeFile("staged.png")
    const { getByTestId } = render(<Harness />)
    const card = getByTestId("composer-card")
    beginAppFileDrag(file, "att-1")
    // Drop OUTSIDE any composer card — nothing is intaken.
    dispatchAct(dragEvent("drop", fakeTransfer({ token: "att-1" }), document.body))
    expect(screen.queryByTestId("attachment-card")).toBeNull()
    // Drop over the composer card — the SAME File object resolves from the
    // registry and stages.
    dispatchAct(dragEvent("drop", fakeTransfer({ token: "att-1" }), card))
    expect(screen.getByTestId("attachment-card")).toHaveTextContent("staged.png")
    // Re-drop of the SAME file id is idempotent (no duplicate card).
    dispatchAct(dragEvent("drop", fakeTransfer({ token: "att-1" }), card))
    expect(screen.getAllByTestId("attachment-card")).toHaveLength(1)
  })

  it("stops routing once the drag ends (endAppFileDrag)", () => {
    const file = makeFile("gone.png")
    const { getByTestId } = render(<Harness />)
    const card = getByTestId("composer-card")
    beginAppFileDrag(file, "att-9")
    endAppFileDrag("att-9")
    dispatchAct(dragEvent("drop", fakeTransfer({ token: "att-9" }), card))
    expect(screen.queryByTestId("attachment-card")).toBeNull()
  })

  it("removal revokes the staging entry and the card disappears", async () => {
    const user = userEvent.setup()
    const { getByTestId } = render(<Harness />)
    const card = getByTestId("composer-card")
    dispatchAct(
      dragEvent("drop", fakeTransfer({ files: [makeFile("bye.txt", "text/plain")] }), card),
    )
    await user.click(screen.getByTestId("attachment-remove"))
    expect(screen.queryByTestId("attachment-card")).toBeNull()
  })
})

describe("paste routing across composers", () => {
  it("stages a file paste directly on the textarea (editable paste path)", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    // File paste outside any editable control (plain body target) — the
    // DOCUMENT router picks the registered composer card.
    const paste = new Event("paste", { bubbles: true, cancelable: true })
    Object.defineProperty(paste, "clipboardData", {
      value: fakeTransfer({ files: [makeFile("pasted.txt", "text/plain")] }),
    })
    dispatchAct(paste)
    expect(screen.getByTestId("attachment-card")).toHaveTextContent("pasted.txt")
  })

  it("addresses the most recently focused composer, never a hidden one", () => {
    render(
      <>
        <Harness />
        <Harness />
      </>,
    )
    // Two registered cards (the shared module registry). Focus into the
    // SECOND card's subtree via focusin.
    const all = document.querySelectorAll("[data-composer-card]")
    const a = all[0] as HTMLElement
    const b = all[1] as HTMLElement
    act(() => {
      a.dispatchEvent(new FocusEvent("focusin", { bubbles: true }))
      b.dispatchEvent(new FocusEvent("focusin", { bubbles: true }))
    })
    // A file paste outside editable controls → the FOCUSED composer (b).
    const paste = new Event("paste", { bubbles: true, cancelable: true })
    Object.defineProperty(paste, "clipboardData", {
      value: fakeTransfer({ files: [makeFile("to-b.txt", "text/plain")] }),
    })
    dispatchAct(paste)
    expect(screen.getAllByTestId("attachment-card")).toHaveLength(1)
    expect(screen.getByTestId("attachment-card").closest("[data-composer-card]")).toBe(b)
    // Hide composer b — it is no longer addressable.
    act(() => {
      b.setAttribute("hidden", "")
    })
    const paste2 = new Event("paste", { bubbles: true, cancelable: true })
    Object.defineProperty(paste2, "clipboardData", {
      value: fakeTransfer({ files: [makeFile("to-a.txt", "text/plain")] }),
    })
    dispatchAct(paste2)
    const cards = screen.getAllByTestId("attachment-card")
    expect(cards).toHaveLength(2)
    expect(cards.some((c) => c.closest("[data-composer-card]") === a)).toBe(true)
  })

  it("inert composers are never addressed (isAddressableComposerCard)", () => {
    const host = document.createElement("div")
    const inertWrap = document.createElement("div")
    inertWrap.setAttribute("inert", "")
    const card = document.createElement("div")
    inertWrap.appendChild(card)
    host.appendChild(inertWrap)
    document.body.appendChild(host)
    expect(isAddressableComposerCard(card, document)).toBe(false)
    inertWrap.removeAttribute("inert")
    expect(isAddressableComposerCard(card, document)).toBe(true)
    // Detached cards are not addressable either.
    const detached = document.createElement("div")
    expect(isAddressableComposerCard(detached, document)).toBe(false)
    host.remove()
  })
})

describe("model helpers", () => {
  it("clipboardFiles / droppedDirectories separate files from directories", () => {
    const file = makeFile("x.txt", "text/plain")
    const dirFile = makeFile("folder")
    const transfer = fakeTransfer({
      files: [file, dirFile],
      items: [
        { kind: "file", getAsFile: () => file },
        {
          kind: "file",
          getAsFile: () => dirFile,
          webkitGetAsEntry: () => ({ isDirectory: true }),
        },
      ],
    })
    const { files, directories } = clipboardFiles(transfer)
    expect(files).toEqual([file, dirFile])
    expect(directories.has(dirFile)).toBe(true)
    const dirs2 = droppedDirectories(transfer, files)
    expect(dirs2.has(dirFile)).toBe(true)
    expect(dirs2.has(file)).toBe(false)
  })
})
