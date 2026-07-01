"use client"

import * as React from "react"
import { cn } from "../lib/utils"
import { AnimatedNumber } from "./animated-number"

function splitText(text: string) {
  const match = /{{\s*count\s*}}/.exec(text)
  if (!match) return { before: "", after: text }
  if (match.index === undefined) return { before: "", after: text }
  return {
    before: text.slice(0, match.index),
    after: text.slice(match.index + match[0].length),
  }
}

function commonPrefixSuffix(one: string, other: string) {
  const a = Array.from(one)
  const b = Array.from(other)
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return {
    stem: a.slice(0, i).join(""),
    one: a.slice(i).join(""),
    other: b.slice(i).join(""),
  }
}

export interface AnimatedCountLabelProps extends React.HTMLAttributes<HTMLSpanElement> {
  count: number
  one: string
  other: string
}

export const AnimatedCountLabel: React.FC<AnimatedCountLabelProps> = ({
  count,
  one,
  other,
  className,
  ...rest
}) => {
  const oneParts = React.useMemo(() => splitText(one), [one])
  const otherParts = React.useMemo(() => splitText(other), [other])
  const singular = Math.round(count) === 1
  const active = singular ? oneParts : otherParts
  const suffix = React.useMemo(() => commonPrefixSuffix(oneParts.after, otherParts.after), [oneParts.after, otherParts.after])
  const splitSuffix =
    oneParts.before === otherParts.before &&
    (oneParts.after.startsWith(otherParts.after) || otherParts.after.startsWith(oneParts.after))
  const before = splitSuffix ? oneParts.before : active.before
  const stem = splitSuffix ? suffix.stem : active.after
  const tail = !splitSuffix ? "" : singular ? suffix.one : suffix.other
  const showTail = splitSuffix && tail.length > 0

  return (
    <span data-component="tool-count-label" className={cn(className)} {...rest}>
      <span data-slot="tool-count-label-before">{before}</span>
      <AnimatedNumber value={count} />
      <span data-slot="tool-count-label-word">
        <span data-slot="tool-count-label-stem">{stem}</span>
        <span data-slot="tool-count-label-suffix" data-active={showTail ? "true" : "false"}>
          <span data-slot="tool-count-label-suffix-inner">{tail}</span>
        </span>
      </span>
    </span>
  )
}