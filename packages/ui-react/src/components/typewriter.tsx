"use client"

import * as React from "react"
import { cn } from "../lib/utils"

export interface TypewriterProps extends React.HTMLAttributes<HTMLElement> {
  text?: string
  /** The element to render. Defaults to `p`. */
  as?: React.ElementType
}

export const Typewriter: React.FC<TypewriterProps> = ({
  text,
  className,
  as: Tag = "p",
  ...rest
}) => {
  const [displayed, setDisplayed] = React.useState("")
  const [typing, setTyping] = React.useState(false)
  const [cursor, setCursor] = React.useState(true)

  React.useEffect(() => {
    if (!text) return
    const timeouts: ReturnType<typeof setTimeout>[] = []
    setTyping(true)
    setDisplayed("")
    setCursor(true)

    let i = 0
    const getTypingDelay = () => {
      const random = Math.random()
      if (random < 0.05) return 150 + Math.random() * 100
      if (random < 0.15) return 80 + Math.random() * 60
      return 30 + Math.random() * 50
    }

    const type = () => {
      if (i < text.length) {
        setDisplayed(text.slice(0, i + 1))
        i++
        timeouts.push(setTimeout(type, getTypingDelay()))
      } else {
        setTyping(false)
        timeouts.push(setTimeout(() => setCursor(false), 2000))
      }
    }

    timeouts.push(setTimeout(type, 200))

    return () => {
      for (const timeout of timeouts) clearTimeout(timeout)
    }
  }, [text])

  return (
    <Tag className={cn(className)} {...rest}>
      {displayed}
      {cursor && <span className={cn(!typing && "blinking-cursor")}>│</span>}
    </Tag>
  )
}