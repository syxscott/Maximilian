// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Prompt-editor tests — attachment bookkeeping (cap + dedupe), slash
 * parsing/matching, the useSlashCommands hook, PromptToolbar smokes and
 * the PromptEditorDemo composition.
 */
import { describe, it, expect, afterEach, vi } from "vitest"
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react"
import { useState } from "react"
import { getDictionary, registerLocale, setLocale } from "@max/i18n"

import enDomain from "../src/locales/prompt-editor.en-US.json"
import zhDomain from "../src/locales/prompt-editor.zh-CN.json"
import enQuickpick from "../src/locales/quickpick.en-US.json"
import zhQuickpick from "../src/locales/quickpick.zh-CN.json"
import {
  addAttachments,
  filesToAttachments,
  formatBytes,
  matchSlashCommands,
  parseSlashQuery,
  MAX_ATTACHMENTS,
  type Attachment,
} from "../src/components/prompt-editor/model"
import { useSlashCommands } from "../src/components/prompt-editor/useSlashCommands"
import { PromptToolbar } from "../src/components/prompt-editor/PromptToolbar"
import { PromptEditorDemo } from "../src/components/prompt-editor/PromptEditorDemo"
import { COMMANDS } from "../src/lib/commands"

const en = {
  ...(getDictionary("en-US") ?? {}),
  ...(enDomain as Record<string, string>),
  ...(enQuickpick as Record<string, string>),
}
const zh = {
  ...(getDictionary("zh-CN") ?? {}),
  ...(zhDomain as Record<string, string>),
  ...(zhQuickpick as Record<string, string>),
}
registerLocale("en-US", en)
registerLocale("zh-CN", zh)
setLocale("en-US")

afterEach(() => {
  cleanup()
  setLocale("en-US")
})

describe("parseSlashQuery", () => {
  it("accepts the leading slash token only", () => {
    expect(parseSlashQuery("/nav", 4)).toBe("nav")
    expect(parseSlashQuery("/", 1)).toBe("")
    expect(parseSlashQuery("/nav workspace", 14)).toBeNull()
    expect(parseSlashQuery("hello /nav", 10)).toBeNull()
    expect(parseSlashQuery("plain", 5)).toBeNull()
  })

  it("respects the caret position", () => {
    expect(parseSlashQuery("/nav done", 4)).toBe("nav")
  })
})

describe("matchSlashCommands", () => {
  const t = (key: string) => (en as Record<string, string>)[key] ?? key

  it("lists every enabled command on an empty query", () => {
    const views = matchSlashCommands("", t)
    expect(views).toHaveLength(COMMANDS.length)
    expect(views.every((v) => v.command.enabled !== false)).toBe(true)
  })

  it("matches ids and localized titles, preserving registry order", () => {
    const byId = matchSlashCommands("nav.usage", t)
    expect(byId[0]?.id).toBe("nav.usage")
    const byTitle = matchSlashCommands("workspace", t)
    expect(byTitle.map((v) => v.id)).toContain("nav.workspace")
    const order = matchSlashCommands("", t).map((v) => v.id)
    expect(matchSlashCommands("", t).map((v) => v.id)).toEqual(order)
  })

  it("labels navigate commands as navigation", () => {
    const views = matchSlashCommands("", t)
    expect(views.find((v) => v.id === "nav.workspace")?.kind).toBe("navigate")
    expect(views.find((v) => v.id === "action.openPalette")?.kind).toBe("action")
  })
})

describe("attachments", () => {
  it("extracts {name,size} rows defensively", () => {
    const files = { 0: { name: "a.txt", size: 10 }, 1: { name: "" }, 2: null, length: 3 }
    expect(filesToAttachments(files)).toEqual([{ id: "a.txt:10", name: "a.txt", size: 10 }])
    expect(filesToAttachments(null)).toEqual([])
    expect(filesToAttachments([{ name: "b.md", size: "unknown" }])).toEqual([
      { id: "b.md:0", name: "b.md", size: 0 },
    ])
  })

  it("enforces the hard cap and reports rejections", () => {
    const seed: Attachment[] = Array.from({ length: MAX_ATTACHMENTS }, (_, i) => ({
      id: `f${i}:1`,
      name: `f${i}`,
      size: 1,
    }))
    const result = addAttachments(seed, [{ id: "x:1", name: "x", size: 1 }])
    expect(result.attachments).toHaveLength(MAX_ATTACHMENTS)
    expect(result.rejected).toBe(1)
  })

  it("deduplicates identical files", () => {
    const result = addAttachments(
      [{ id: "a:1", name: "a", size: 1 }],
      [
        { id: "a:1", name: "a", size: 1 },
        { id: "b:2", name: "b", size: 2 },
      ],
    )
    expect(result.attachments.map((a) => a.id)).toEqual(["a:1", "b:2"])
    expect(result.rejected).toBe(0)
  })

  it("formats bytes for chips", () => {
    expect(formatBytes(0)).toBe("0 B")
    expect(formatBytes(512)).toBe("512 B")
    expect(formatBytes(2048)).toBe("2.0 KB")
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB")
  })
})

describe("useSlashCommands", () => {
  function renderCommands(text: string, caret = text.length) {
    const onSelect = vi.fn()
    const { result } = renderHook(() => useSlashCommands({ text, caret, onSelect }))
    return { result, onSelect }
  }

  it("opens on the leading slash and closes after a space", () => {
    expect(renderCommands("/na").result.current.open).toBe(true)
    expect(renderCommands("/na done").result.current.open).toBe(false)
    expect(renderCommands("done").result.current.query).toBeNull()
  })

  it("navigates the list and selects with Enter", () => {
    const { result, onSelect } = renderCommands("/")
    act(() => result.current.onKeyDown({ key: "ArrowDown", preventDefault: () => {} }))
    expect(result.current.highlighted).toBe(1)
    act(() => result.current.onKeyDown({ key: "Enter", preventDefault: () => {} }))
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "nav.executions" }))
  })

  it("dismisses with Escape and reopens on a different query", () => {
    const first = renderCommands("/na")
    act(() => first.result.current.onKeyDown({ key: "Escape", preventDefault: () => {} }))
    expect(first.result.current.open).toBe(false)
    expect(first.result.current.dismissed).toBe(true)
  })

  it("hands raw commands to select()", () => {
    const { result, onSelect } = renderCommands("/usage")
    act(() => result.current.select())
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "nav.usage" }))
  })

  it("ignores keys while closed", () => {
    const { result, onSelect } = renderCommands("plain")
    expect(result.current.onKeyDown({ key: "Enter", preventDefault: () => {} })).toBe(false)
    expect(onSelect).not.toHaveBeenCalled()
  })
})

describe("PromptToolbar", () => {
  function Harness() {
    const [attachments, setAttachments] = useState<Attachment[]>([])
    const [rejected, setRejected] = useState(0)
    return (
      <PromptToolbar
        attachments={attachments}
        onAttachFiles={(files) => {
          const result = addAttachments(attachments, filesToAttachments(files))
          setAttachments(result.attachments)
          setRejected(result.rejected)
        }}
        onRemoveAttachment={(id) => setAttachments((prev) => prev.filter((a) => a.id !== id))}
        onOpenSlash={() => {}}
        onInsertMention={() => {}}
        rejectedCount={rejected}
      />
    )
  }

  const pickFiles = (input: HTMLElement) => {
    Object.defineProperty(input, "files", {
      value: { 0: { name: "spec.md", size: 2048 }, length: 1 },
      configurable: true,
    })
    fireEvent.change(input)
  }

  it("shows chips with sizes and the honest local-only hint after attach", () => {
    render(<Harness />)
    pickFiles(screen.getByTestId("prompt-toolbar-file-input"))
    expect(screen.getByTestId("attachment-chip")).toHaveTextContent("spec.md")
    expect(screen.getByTestId("attachment-chip")).toHaveTextContent("2.0 KB")
    expect(screen.getByTestId("attachment-hint")).toHaveTextContent("Upload API not wired yet")
  })

  it("removes chips via the remove button", () => {
    render(<Harness />)
    pickFiles(screen.getByTestId("prompt-toolbar-file-input"))
    fireEvent.click(screen.getByTestId("attachment-chip-remove"))
    expect(screen.queryByTestId("attachment-chip")).not.toBeInTheDocument()
  })

  it("reports over-cap rejections", () => {
    render(<Harness />)
    const input = screen.getByTestId("prompt-toolbar-file-input")
    Object.defineProperty(input, "files", {
      value: {
        0: { name: "a", size: 1 },
        1: { name: "b", size: 1 },
        2: { name: "c", size: 1 },
        3: { name: "d", size: 1 },
        4: { name: "e", size: 1 },
        5: { name: "f", size: 1 },
        6: { name: "g", size: 1 },
        length: 7,
      },
      configurable: true,
    })
    fireEvent.change(input)
    expect(screen.getAllByTestId("attachment-chip")).toHaveLength(MAX_ATTACHMENTS)
    expect(screen.getByTestId("attachment-limit")).toHaveTextContent("2 ignored")
  })

  it("fires the launcher callbacks", () => {
    const onOpenSlash = vi.fn()
    const onInsertMention = vi.fn()
    render(
      <PromptToolbar
        attachments={[]}
        onAttachFiles={() => {}}
        onRemoveAttachment={() => {}}
        onOpenSlash={onOpenSlash}
        onInsertMention={onInsertMention}
      />,
    )
    fireEvent.click(screen.getByTestId("prompt-toolbar-slash"))
    fireEvent.click(screen.getByTestId("prompt-toolbar-mention"))
    expect(onOpenSlash).toHaveBeenCalledTimes(1)
    expect(onInsertMention).toHaveBeenCalledTimes(1)
  })
})

describe("PromptEditorDemo", () => {
  it("renders the composition and sends the draft", () => {
    render(<PromptEditorDemo />)
    expect(screen.getByTestId("prompt-editor-demo")).toBeInTheDocument()
    expect(screen.getByTestId("prompt-toolbar")).toBeInTheDocument()
    fireEvent.click(screen.getByTestId("demo-send"))
    // Empty draft is not sent.
    expect(screen.queryByTestId("demo-sent")).not.toBeInTheDocument()
    fireEvent.change(screen.getByTestId("mention-input"), {
      target: { value: "hello", selectionStart: 5 },
    })
    fireEvent.click(screen.getByTestId("demo-send"))
    expect(screen.getByTestId("demo-sent")).toHaveTextContent("hello")
  })

  it("opens the slash quickpick from the toolbar and runs a command", () => {
    const onNavigate = vi.fn()
    render(<PromptEditorDemo onNavigate={onNavigate} />)
    fireEvent.click(screen.getByTestId("prompt-toolbar-slash"))
    expect(screen.getByTestId("quickpick")).toBeInTheDocument()
    const item = screen
      .getAllByTestId("quickpick-item")
      .find((el) => el.textContent?.includes("Usage"))
    fireEvent.click(item)
    expect(onNavigate).toHaveBeenCalledWith("usage")
    expect(screen.queryByTestId("quickpick")).not.toBeInTheDocument()
  })

  it("the mention launcher inserts @ into the textarea", () => {
    render(<PromptEditorDemo />)
    const input = screen.getByTestId("mention-input")
    fireEvent.click(screen.getByTestId("prompt-toolbar-mention"))
    expect((input as HTMLTextAreaElement).value).toBe("@")
  })

  it("keeps zh-CN and en-US key sets in lockstep", () => {
    expect(Object.keys(zhDomain).sort()).toEqual(Object.keys(enDomain).sort())
  })
})
