"use client"

import * as React from "react"
import * as HoverCard from "@radix-ui/react-hover-card"
import { cn } from "../lib/utils.js"

export interface MessageNavItem {
  id: string
  summary?: { title?: string; diffs?: unknown[] }
  // Allow extra properties for UserMessage
  [key: string]: unknown
}

export interface MessageNavProps extends Omit<React.HTMLAttributes<HTMLUListElement>, "children"> {
  messages: MessageNavItem[]
  current?: MessageNavItem
  size: "normal" | "compact"
  onMessageSelect: (message: MessageNavItem) => void
  getLabel?: (message: MessageNavItem) => string | undefined
}

const MessageNavContent: React.FC<{
  messages: MessageNavItem[]
  current?: MessageNavItem
  size: "normal" | "compact"
  onMessageSelect: (message: MessageNavItem) => void
  getLabel?: (message: MessageNavItem) => string | undefined
  className?: string
}> = ({ messages, current, size, onMessageSelect, getLabel, className }) => {
  const handleClick = (message: MessageNavItem) => () => onMessageSelect(message)
  const handleKeyPress = (message: MessageNavItem) => (event: React.KeyboardEvent) => {
    if (event.key !== "Enter" && event.key !== " ") return
    event.preventDefault()
    onMessageSelect(message)
  }

  return (
    <ul role="list" data-component="message-nav" data-size={size} className={cn(className)}>
      {messages.map((message) => (
        <li key={message.id} data-slot="message-nav-item">
          {size === "compact" ? (
            <div
              data-slot="message-nav-tick-button"
              data-active={message.id === current?.id || undefined}
              role="button"
              tabIndex={0}
              onClick={handleClick(message)}
              onKeyDown={handleKeyPress(message)}
            >
              <div data-slot="message-nav-tick-line" />
            </div>
          ) : (
            <button
              data-slot="message-nav-message-button"
              onClick={handleClick(message)}
              onKeyDown={handleKeyPress(message)}
            >
              <DiffChangesPlaceholder changes={(message.summary?.diffs ?? []) as never} variant="bars" />
              <div
                data-slot="message-nav-title-preview"
                data-active={message.id === current?.id || undefined}
              >
                {getLabel?.(message) ?? message.summary?.title ?? "New message"}
              </div>
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}

const DiffChangesPlaceholder: React.FC<{ changes: unknown[]; variant: "bars" }> = () => {
  return <span data-slot="diff-changes" data-variant="bars" />
}

export const MessageNav: React.FC<MessageNavProps> = ({
  messages,
  current,
  size,
  onMessageSelect,
  getLabel,
  className,
  ...rest
}) => {
  const [open, setOpen] = React.useState(false)
  const selectAndClose = (message: MessageNavItem) => {
    setOpen(false)
    onMessageSelect(message)
  }

  if (size === "compact") {
    return (
      <HoverCard.Root
        open={open}
        onOpenChange={setOpen}
        openDelay={0}
        closeDelay={120}
      >
        <HoverCard.Trigger asChild>
          <div data-component="message-nav-hovercard" className={cn(className)}>
            <MessageNavContent
              messages={messages}
              current={current}
              size="compact"
              onMessageSelect={selectAndClose}
              getLabel={getLabel}
            />
          </div>
        </HoverCard.Trigger>
        <HoverCard.Portal>
          <HoverCard.Content
            data-slot="message-nav-hovercard-content"
            side="right"
            sideOffset={8}
          >
            <MessageNavContent
              messages={messages}
              current={current}
              size="normal"
              onMessageSelect={selectAndClose}
              getLabel={getLabel}
            />
          </HoverCard.Content>
        </HoverCard.Portal>
      </HoverCard.Root>
    )
  }

  return (
    <MessageNavContent
      messages={messages}
      current={current}
      size="normal"
      onMessageSelect={onMessageSelect}
      getLabel={getLabel}
      className={className}
    />
  )
}