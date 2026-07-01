// @ts-nocheck
/**
 * QuestionPrompt: multi-tab question UI with single/multi-select answers.
 *
 * Ported from OpenCode's SolidJS `question.tsx`. The original used
 * `createStore`, `createMemo`, `createSignal`, `For`, `Show`, `<scrollbox>`,
 * `<textarea>`, `useRenderer`, `useBindings`, `useOpencodeModeStack`, and
 * `tint`/`selectedForeground` from theme.
 *
 * We port to React `useState`, `useMemo`, conditional JSX, and `.map()`.
 * OpenTUI-specific primitives are simplified:
 *   - textarea: replaced by a basic text input via useInput.
 *   - useRenderer.getSelection(): removed (ink has no native selection).
 *   - useBindings: replaced by useInput.
 *   - useOpencodeModeStack: removed (not available in Maximilian).
 *   - tint(): inlined as a simple color approximation.
 */

import React, { useCallback, useMemo, useState } from "react"
import { Box, Text, useInput } from "ink"
import { useTheme } from "../../context/theme"
import { useSDK } from "../../context/sdk"

// ---------------------------------------------------------------------------
// Types (matching OpenCode SDK shapes)
// ---------------------------------------------------------------------------

type QuestionOption = {
  label: string
  description?: string
}

type Question = {
  header?: string
  question?: string
  options?: QuestionOption[]
  custom?: boolean
  multiple?: boolean
}

type QuestionAnswer = string[]

type QuestionRequest = {
  id: string
  questions: Question[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Approximation of OpenCode's `tint` (blend two hex colors). */
function tint(base: string, accent: string, _ratio: number): string {
  // For ink, we just return the accent color as a simple approximation.
  void base
  return accent
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function QuestionPrompt(props: { request: QuestionRequest; directory?: string }) {
  const sdk = useSDK()
  const { theme } = useTheme()

  const questions = useMemo(() => props.request.questions, [props.request.questions])
  const single = useMemo(() => questions.length === 1 && questions[0]?.multiple !== true, [questions])
  const tabs = useMemo(() => (single ? 1 : questions.length + 1), [single, questions])

  const [tab, setTab] = useState(0)
  const [answers, setAnswers] = useState<QuestionAnswer[]>([])
  const [customInputs, setCustomInputs] = useState<string[]>([])
  const [selected, setSelected] = useState(0)
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState("")

  const question = useMemo(() => questions[tab], [questions, tab])
  const isConfirm = useMemo(() => !single && tab === questions.length, [single, tab, questions.length])
  const options = useMemo(() => question?.options ?? [], [question])
  const allowCustom = useMemo(() => question?.custom !== false, [question])
  const isOther = useMemo(() => allowCustom && selected === options.length, [allowCustom, selected, options.length])
  const customValue = useMemo(() => customInputs[tab] ?? "", [customInputs, tab])
  const multi = useMemo(() => question?.multiple === true, [question])
  const customPicked = useMemo(() => {
    const value = customValue
    if (!value) return false
    return answers[tab]?.includes(value) ?? false
  }, [customValue, answers, tab])

  const submit = useCallback(() => {
    const allAnswers = questions.map((_, i) => answers[i] ?? [])
    void sdk.client.question?.reply?.({
      requestID: props.request.id,
      directory: props.directory,
      answers: allAnswers,
    })
  }, [questions, answers, sdk, props])

  const reject = useCallback(() => {
    void sdk.client.question?.reject?.({
      requestID: props.request.id,
      directory: props.directory,
    })
  }, [sdk, props])

  const pick = useCallback(
    (answer: string, isCustom: boolean = false) => {
      const nextAnswers = [...answers]
      nextAnswers[tab] = [answer]
      setAnswers(nextAnswers)

      if (isCustom) {
        const nextCustom = [...customInputs]
        nextCustom[tab] = answer
        setCustomInputs(nextCustom)
      }

      if (single) {
        void sdk.client.question?.reply?.({
          requestID: props.request.id,
          directory: props.directory,
          answers: [[answer]],
        })
        return
      }

      setTab(tab + 1)
      setSelected(0)
    },
    [answers, customInputs, tab, single, sdk, props],
  )

  const toggle = useCallback(
    (answer: string) => {
      const existing = answers[tab] ?? []
      const next = [...existing]
      const index = next.indexOf(answer)
      if (index === -1) next.push(answer)
      else next.splice(index, 1)
      const nextAnswers = [...answers]
      nextAnswers[tab] = next
      setAnswers(nextAnswers)
    },
    [answers, tab],
  )

  const selectOption = useCallback(() => {
    if (isOther) {
      if (!multi) {
        setEditing(true)
        setEditValue(customValue)
        return
      }
      if (customValue && customPicked) {
        toggle(customValue)
        return
      }
      setEditing(true)
      setEditValue(customValue)
      return
    }
    const opt = options[selected]
    if (!opt) return
    if (multi) {
      toggle(opt.label)
      return
    }
    pick(opt.label)
  }, [isOther, multi, customValue, customPicked, options, selected, pick, toggle])

  const moveTo = useCallback(
    (index: number) => {
      setSelected(index)
    },
    [],
  )

  const selectTab = useCallback(
    (index: number) => {
      setTab(index)
      setSelected(0)
    },
    [],
  )

  // Handle editing mode input
  useInput(
    (input, key) => {
      if (!editing) return
      if (key.escape) {
        setEditing(false)
        return
      }
      if (key.backspace || key.delete) {
        setEditValue((prev) => prev.slice(0, -1))
        return
      }
      if (key.return) {
        const text = editValue.trim()
        const prev = customInputs[tab]

        if (!text) {
          if (prev) {
            const nextCustom = [...customInputs]
            nextCustom[tab] = ""
            setCustomInputs(nextCustom)

            const nextAnswers = [...answers]
            nextAnswers[tab] = (nextAnswers[tab] ?? []).filter((x) => x !== prev)
            setAnswers(nextAnswers)
          }
          setEditing(false)
          return
        }

        if (multi) {
          const nextCustom = [...customInputs]
          nextCustom[tab] = text
          setCustomInputs(nextCustom)

          const existing = answers[tab] ?? []
          const next = [...existing]
          if (prev) {
            const index = next.indexOf(prev)
            if (index !== -1) next.splice(index, 1)
          }
          if (!next.includes(text)) next.push(text)
          const nextAnswers = [...answers]
          nextAnswers[tab] = next
          setAnswers(nextAnswers)
          setEditing(false)
          return
        }

        pick(text, true)
        setEditing(false)
        return
      }
      if (input && !key.ctrl && !key.meta) {
        setEditValue((prev) => prev + input)
      }
    },
    { isActive: editing && !isConfirm },
  )

  // Handle navigation mode input
  const totalOptions = options.length + (allowCustom ? 1 : 0)
  const maxKey = Math.min(totalOptions, 9)

  useInput(
    (input, key) => {
      if (editing) return

      if (isConfirm) {
        if (key.return) {
          submit()
          return
        }
        if (key.escape) {
          reject()
          return
        }
        return
      }

      // Tab navigation
      if (key.tab) {
        // shift detection not available in ink; always move forward
        selectTab((tab + 1) % tabs)
        return
      }

      // Number keys for quick select
      const num = parseInt(input, 10)
      if (num >= 1 && num <= maxKey) {
        moveTo(num - 1)
        // auto-select after moving
        setTimeout(() => {
          const idx = num - 1
          if (idx === options.length && allowCustom) {
            if (!multi) {
              setEditing(true)
              setEditValue(customValue)
            }
          } else {
            const opt = options[idx]
            if (opt) {
              if (multi) toggle(opt.label)
              else pick(opt.label)
            }
          }
        }, 0)
        return
      }

      if (key.up || input === "k") {
        moveTo((selected - 1 + totalOptions) % totalOptions)
        return
      }
      if (key.down || input === "j") {
        moveTo((selected + 1) % totalOptions)
        return
      }
      if (key.left || input === "h") {
        selectTab((tab - 1 + tabs) % tabs)
        return
      }
      if (key.right || input === "l") {
        selectTab((tab + 1) % tabs)
        return
      }
      if (key.return) {
        selectOption()
        return
      }
      if (key.escape) {
        reject()
      }
    },
    { isActive: !editing },
  )

  return (
    <Box
      flexDirection="column"
      paddingLeft={1}
      paddingRight={3}
      paddingTop={1}
      paddingBottom={1}
      borderStyle="single"
      borderColor={theme.accent}
    >
      {/* Tabs */}
      {!single ? (
        <Box flexDirection="row" gap={1} paddingLeft={1}>
          {questions.map((q, index) => {
            const isActive = index === tab
            const isAnswered = (answers[index]?.length ?? 0) > 0
            return (
              <Box
                key={index}
                paddingLeft={1}
                paddingRight={1}
              >
                <Text
                  color={isActive ? selectedForeground(theme, theme.accent) : isAnswered ? theme.text : undefined}
                  dimColor={!isActive && !isAnswered}
                >
                  {q.header}
                </Text>
              </Box>
            )
          })}
          <Box paddingLeft={1} paddingRight={1}>
            <Text
              color={isConfirm ? selectedForeground(theme, theme.accent) : undefined}
              dimColor={!isConfirm}
            >
              Confirm
            </Text>
          </Box>
        </Box>
      ) : null}

      {/* Question content */}
      {!isConfirm ? (
        <Box paddingLeft={1} gap={1} flexDirection="column">
          <Box>
            <Text color={theme.text}>
              {question?.question}
              {multi ? " (select all that apply)" : ""}
            </Text>
          </Box>
          <Box flexDirection="column">
            {options.map((opt, i) => {
              const active = i === selected
              const picked = answers[tab]?.includes(opt.label) ?? false
              return (
                <Box key={i} flexDirection="column">
                  <Box flexDirection="row">
                    <Box paddingRight={1}>
                      <Text color={active ? tint(theme.textMuted, theme.secondary, 0.6) : undefined} dimColor={!active}>
                        {`${i + 1}.`}
                      </Text>
                    </Box>
                    <Box>
                      <Text color={active ? theme.secondary : picked ? theme.success : theme.text}>
                        {multi ? `[${picked ? "x" : " "}] ${opt.label}` : opt.label}
                      </Text>
                    </Box>
                    {!multi ? (
                      <Text color={theme.success}>{picked ? " v" : ""}</Text>
                    ) : null}
                  </Box>
                  {opt.description ? (
                    <Box paddingLeft={3}>
                      <Text dimColor>{opt.description}</Text>
                    </Box>
                  ) : null}
                </Box>
              )
            })}

            {/* Custom answer option */}
            {allowCustom ? (
              <Box flexDirection="column">
                <Box flexDirection="row">
                  <Box paddingRight={1}>
                    <Text color={isOther ? tint(theme.textMuted, theme.secondary, 0.6) : undefined} dimColor={!isOther}>
                      {`${options.length + 1}.`}
                    </Text>
                  </Box>
                  <Box>
                    <Text color={isOther ? theme.secondary : customPicked ? theme.success : theme.text}>
                      {multi ? `[${customPicked ? "x" : " "}] Type your own answer` : "Type your own answer"}
                    </Text>
                  </Box>
                  {!multi ? (
                    <Text color={theme.success}>{customPicked ? " v" : ""}</Text>
                  ) : null}
                </Box>

                {editing ? (
                  <Box paddingLeft={3}>
                    <Text color={theme.text}>
                      {editValue}<Text color={theme.primary}>_</Text>
                    </Text>
                  </Box>
                ) : null}

                {!editing && customValue ? (
                  <Box paddingLeft={3}>
                    <Text dimColor>{customValue}</Text>
                  </Box>
                ) : null}
              </Box>
            ) : null}
          </Box>
        </Box>
      ) : null}

      {/* Confirm / Review tab */}
      {isConfirm && !single ? (
        <Box paddingLeft={1} flexDirection="column">
          <Text color={theme.text}>Review</Text>
          {questions.map((q, index) => {
            const value = answers[index]?.join(", ") ?? ""
            const answered = Boolean(value)
            return (
              <Box key={index} paddingLeft={1}>
                <Text>
                  <Text dimColor>{q.header}: </Text>
                  <Text color={answered ? theme.text : theme.error}>
                    {answered ? value : "(not answered)"}
                  </Text>
                </Text>
              </Box>
            )
          })}
        </Box>
      ) : null}

      {/* Footer hints */}
      <Box flexDirection="row" gap={2} paddingTop={1} paddingLeft={2}>
        {!single ? (
          <Text>
            <Text dimColor>tab</Text>
          </Text>
        ) : null}
        {!isConfirm ? (
          <Text>
            <Text dimColor>up/down select</Text>
          </Text>
        ) : null}
        <Text>
          enter{" "}
          <Text dimColor>
            {isConfirm ? "submit" : multi ? "toggle" : single ? "submit" : "confirm"}
          </Text>
        </Text>
        <Text>
          esc <Text dimColor>dismiss</Text>
        </Text>
      </Box>
    </Box>
  )
}
