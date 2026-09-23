// Copyright (c) 2026 Maximilian contributors
// SPDX-License-Identifier: MIT
//
// Licensed under the MIT License. See LICENSE in the project root.

/**
 * Mentions tests — the provider catalog (roles / skills / workspaces),
 * the trigger router and insertion model, plus MentionTextarea render
 * smokes over the composed useMention hook.
 */
import { describe, it, expect, afterEach } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import { getDictionary, registerLocale, setLocale } from "@max/i18n"

import enDomain from "../src/locales/mentions.en-US.json"
import zhDomain from "../src/locales/mentions.zh-CN.json"
import {
  ROLE_TOKENS,
  activeTrigger,
  insertTriggerToken,
  createRolesProvider,
  createSkillsProvider,
  createWorkspacesProvider,
  providersForTrigger,
  poolForTrigger,
  workspaceToken,
  type MentionProvider,
  type WorkspaceRef,
} from "../src/components/mentions/model"
import { MentionTextarea } from "../src/components/mentions/MentionTextarea"

const en = { ...(getDictionary("en-US") ?? {}), ...(enDomain as Record<string, string>) }
const zh = { ...(getDictionary("zh-CN") ?? {}), ...(zhDomain as Record<string, string>) }
registerLocale("en-US", en)
registerLocale("zh-CN", zh)
setLocale("en-US")

afterEach(() => {
  cleanup()
  setLocale("en-US")
})

const ident = (key: string) => key

describe("activeTrigger", () => {
  const triggers = ["@", "#"]

  it("finds the trigger+token at the caret", () => {
    expect(activeTrigger("hey @pl", 7, triggers)).toEqual({ trigger: "@", token: "pl" })
    expect(activeTrigger("#max", 4, triggers)).toEqual({ trigger: "#", token: "max" })
    expect(activeTrigger("@", 1, triggers)).toEqual({ trigger: "@", token: "" })
  })

  it("returns null when no trigger is active", () => {
    expect(activeTrigger("plain text", 10, triggers)).toBeNull()
    expect(activeTrigger("@done done", 10, triggers)).toBeNull()
  })
})

describe("insertTriggerToken", () => {
  it("replaces the partial token for any trigger", () => {
    const at = insertTriggerToken("ping @pl now", 8, "@", "planner")
    expect(at.text).toBe("ping @planner  now")
    expect(at.caret).toBe("ping @planner ".length)
    const hash = insertTriggerToken("see #mai", 8, "#", "maximilian-main")
    expect(hash.text.startsWith("see #maximilian-main ")).toBe(true)
  })

  it("is a no-op without an active token", () => {
    expect(insertTriggerToken("abc", 3, "@", "planner")).toEqual({ text: "abc", caret: 3 })
  })
})

describe("providers", () => {
  it("roles: the static four roles, filtered by prefix", () => {
    const provider = createRolesProvider(ident)
    expect(provider.triggers).toEqual(["@"])
    expect(provider.list("").map((s) => s.token)).toEqual([...ROLE_TOKENS])
    expect(provider.list("re").map((s) => s.token)).toEqual(["reviewer", "researcher"])
    expect(provider.list("zzz")).toEqual([])
    expect(provider.list("pl")[0]?.description).toBe("mentions.roles.planner.desc")
  })

  it("skills: placeholder catalog from the injected flags getter", () => {
    const provider = createSkillsProvider(ident, () => ["code-review", "bench"])
    expect(provider.triggers).toEqual(["@"])
    expect(provider.list("").map((s) => s.token)).toEqual(["code-review", "bench"])
    expect(provider.list("code")[0]?.description).toBe("mentions.skills.placeholderDesc")
  })

  it("skills: empty (plus UI explanation) when flags are unavailable", () => {
    const provider = createSkillsProvider(ident)
    expect(provider.list("")).toEqual([])
    const throwing = createSkillsProvider(ident, () => {
      throw new Error("flags down")
    })
    expect(throwing.list("")).toEqual([])
  })

  it("workspaces: props-injected list, names slugified to mention tokens", () => {
    const workspaces: WorkspaceRef[] = [
      { id: "ws-1", name: "Maximilian Main", path: "~/Maximilian" },
      { id: "ws-2" },
      // @ts-expect-error defensive passthrough input
      null,
    ]
    const provider = createWorkspacesProvider(ident, workspaces)
    expect(provider.triggers).toEqual(["#"])
    expect(provider.list("").map((s) => s.token)).toEqual(["maximilian-main", "ws-2"])
    expect(provider.list("max")[0]?.description).toBe("~/Maximilian")
    expect(provider.list("ws-2")[0]?.description).toBe("mentions.workspaces.desc")
  })

  it("workspaceToken slugifies arbitrary names", () => {
    expect(workspaceToken("Maximilian Main!")).toBe("maximilian-main")
    expect(workspaceToken("---")).toBe("")
  })

  it("the router pools all providers sharing a trigger", () => {
    const providers: MentionProvider[] = [
      createRolesProvider(ident),
      createSkillsProvider(ident, () => ["bench"]),
      createWorkspacesProvider(ident, [{ id: "ws-1", name: "Main" }]),
    ]
    expect(providersForTrigger(providers, "@")).toHaveLength(2)
    const atPool = poolForTrigger(providers, "@", "").map((s) => s.token)
    expect(atPool).toContain("planner")
    expect(atPool).toContain("bench")
    expect(atPool).not.toContain("main")
    expect(poolForTrigger(providers, "#", "").map((s) => s.token)).toEqual(["main"])
  })
})

describe("MentionTextarea", () => {
  const workspaces: WorkspaceRef[] = [{ id: "ws-1", name: "Maximilian Main", path: "~/Maximilian" }]
  const providers: MentionProvider[] = [
    createRolesProvider((key) => en[key as keyof typeof en] as string),
    createSkillsProvider((key) => en[key as keyof typeof en] as string),
    createWorkspacesProvider((key) => en[key as keyof typeof en] as string, workspaces),
  ]

  function Harness(props: { providers: MentionProvider[]; initial?: string }) {
    const [value, setValue] = useState(props.initial ?? "")
    return <MentionTextarea value={value} onChange={setValue} providers={props.providers} />
  }

  const type = (value: string) => {
    const input = screen.getByTestId("mention-input")
    const caret = value.length
    fireEvent.change(input, { target: { value, selectionStart: caret, selectionEnd: caret } })
    fireEvent.keyUp(input, { target: { value, selectionStart: caret, selectionEnd: caret } })
    return input
  }

  it("opens the popup on @ and lists the pooled roles+skills", () => {
    render(<Harness providers={providers} />)
    type("@")
    const options = screen.getAllByTestId("mention-option")
    const tokens = options.map((o) => o.textContent)
    expect(tokens.some((text) => text?.includes("planner"))).toBe(true)
    expect(options.length).toBeGreaterThanOrEqual(ROLE_TOKENS.length)
  })

  it("filters suggestions as the token grows", () => {
    render(<Harness providers={providers} />)
    type("@re")
    const tokens = screen
      .getAllByTestId("mention-option")
      .map((o) => o.textContent)
      .join("|")
    expect(tokens).toContain("reviewer")
    expect(tokens).toContain("researcher")
    expect(tokens).not.toContain("planner")
  })

  it("routes # to the workspaces provider", () => {
    render(<Harness providers={providers} />)
    type("#")
    expect(screen.getByText("#maximilian-main")).toBeInTheDocument()
  })

  it("applies the highlighted suggestion with Enter", () => {
    render(<Harness providers={providers} />)
    const input = type("@pl")
    fireEvent.keyDown(input, { key: "Enter" })
    expect((input as HTMLTextAreaElement).value).toContain("@planner")
    expect(screen.queryByTestId("mention-popup")).not.toBeInTheDocument()
  })

  it("shows the skills-empty explanation when @ matches nothing", () => {
    render(<Harness providers={providers} />)
    type("@zzz")
    expect(screen.getByTestId("mention-empty")).toHaveTextContent(
      "No skills enabled by feature flags",
    )
  })

  it("renders plain text without any popup", () => {
    render(<Harness providers={providers} initial="just typing" />)
    expect(screen.queryByTestId("mention-popup")).not.toBeInTheDocument()
    expect(screen.queryByTestId("mention-empty")).not.toBeInTheDocument()
  })

  it("supports mouse selection from the popup", () => {
    render(<Harness providers={providers} />)
    const input = type("@co")
    fireEvent.mouseDown(screen.getAllByTestId("mention-option")[0])
    expect((input as HTMLTextAreaElement).value).toContain("@coder")
  })

  it("respects the Escape dismissal from the composed hook", () => {
    render(<Harness providers={providers} />)
    const input = type("@pl")
    act(() => {
      fireEvent.keyDown(input, { key: "Escape" })
    })
    expect(screen.queryByTestId("mention-popup")).not.toBeInTheDocument()
  })
})
