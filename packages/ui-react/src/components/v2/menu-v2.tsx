import * as React from "react"
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu"
import * as ContextMenuPrimitive from "@radix-ui/react-context-menu"
import { cn } from "../../lib/utils.js"

const ChevronRight = () => (
  <svg
    data-slot="menu-v2-item-chevron"
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <path d="M6 4L10 8L6 12V4Z" fill="currentColor" />
  </svg>
)

const CheckMark = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 16 16"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <path
      d="M3.53564 8.17857L6.39279 11.75L12.4642 4.25"
      stroke="currentColor"
      strokeWidth="1"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

const ItemBody: React.FC<{
  shortcut?: React.ReactNode
  badge?: React.ReactNode
  trailing?: React.ReactNode
  children?: React.ReactNode
}> = ({ shortcut, badge, trailing, children }) => (
  <>
    <span data-slot="menu-v2-item-content">{children}</span>
    {shortcut ? <span data-slot="menu-v2-item-shortcut">{shortcut}</span> : null}
    {badge ? <span data-slot="menu-v2-item-badge">{badge}</span> : null}
    {trailing}
  </>
)

export interface MenuV2ItemProps
  extends React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> {
  shortcut?: React.ReactNode
  badge?: React.ReactNode
}

export const MenuV2Item = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Item>,
  MenuV2ItemProps
>(({ className, shortcut, badge, children, ...props }, ref) => (
  <DropdownMenuPrimitive.Item
    ref={ref}
    data-component="menu-v2-item"
    className={cn(className)}
    {...props}
  >
    <ItemBody shortcut={shortcut} badge={badge}>
      {children}
    </ItemBody>
  </DropdownMenuPrimitive.Item>
))
MenuV2Item.displayName = "MenuV2Item"

export interface MenuV2CheckboxItemProps
  extends React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.CheckboxItem> {
  shortcut?: React.ReactNode
  badge?: React.ReactNode
}

export const MenuV2CheckboxItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.CheckboxItem>,
  MenuV2CheckboxItemProps
>(({ className, shortcut, badge, children, ...props }, ref) => (
  <DropdownMenuPrimitive.CheckboxItem
    ref={ref}
    data-component="menu-v2-item"
    className={cn(className)}
    {...props}
  >
    <ItemBody
      shortcut={shortcut}
      badge={badge}
      trailing={
        <DropdownMenuPrimitive.ItemIndicator
          data-slot="menu-v2-item-indicator"
          forceMount
        >
          <CheckMark />
        </DropdownMenuPrimitive.ItemIndicator>
      }
    >
      {children}
    </ItemBody>
  </DropdownMenuPrimitive.CheckboxItem>
))
MenuV2CheckboxItem.displayName = "MenuV2CheckboxItem"

export interface MenuV2RadioItemProps
  extends React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.RadioItem> {
  shortcut?: React.ReactNode
  badge?: React.ReactNode
}

export const MenuV2RadioItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.RadioItem>,
  MenuV2RadioItemProps
>(({ className, shortcut, badge, children, ...props }, ref) => (
  <DropdownMenuPrimitive.RadioItem
    ref={ref}
    data-component="menu-v2-item"
    className={cn(className)}
    {...props}
  >
    <ItemBody
      shortcut={shortcut}
      badge={badge}
      trailing={
        <DropdownMenuPrimitive.ItemIndicator
          data-slot="menu-v2-item-indicator"
          forceMount
        >
          <CheckMark />
        </DropdownMenuPrimitive.ItemIndicator>
      }
    >
      {children}
    </ItemBody>
  </DropdownMenuPrimitive.RadioItem>
))
MenuV2RadioItem.displayName = "MenuV2RadioItem"

export interface MenuV2SubTriggerProps
  extends React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubTrigger> {
  shortcut?: React.ReactNode
  badge?: React.ReactNode
}

export const MenuV2SubTrigger = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.SubTrigger>,
  MenuV2SubTriggerProps
>(({ className, shortcut, badge, children, ...props }, ref) => (
  <DropdownMenuPrimitive.SubTrigger
    ref={ref}
    data-component="menu-v2-item"
    className={cn(className)}
    {...props}
  >
    <ItemBody shortcut={shortcut} badge={badge} trailing={<ChevronRight />}>
      {children}
    </ItemBody>
  </DropdownMenuPrimitive.SubTrigger>
))
MenuV2SubTrigger.displayName = "MenuV2SubTrigger"

export const MenuV2SubContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.SubContent>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubContent>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.SubContent
    ref={ref}
    data-component="menu-v2-content"
    className={cn(className)}
    {...props}
  />
))
MenuV2SubContent.displayName = "MenuV2SubContent"

export const MenuV2GroupLabel = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Label
    ref={ref}
    data-slot="menu-v2-group-label"
    className={cn(className)}
    {...props}
  />
))
MenuV2GroupLabel.displayName = "MenuV2GroupLabel"

export const MenuV2Separator = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Separator
    ref={ref}
    data-slot="menu-v2-separator"
    className={cn(className)}
    {...props}
  />
))
MenuV2Separator.displayName = "MenuV2Separator"

export const MenuV2Content = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Content
    ref={ref}
    data-component="menu-v2-content"
    className={cn(className)}
    {...props}
  />
))
MenuV2Content.displayName = "MenuV2Content"

const MenuV2Root = DropdownMenuPrimitive.Root
const MenuV2Trigger = DropdownMenuPrimitive.Trigger
const MenuV2Portal = DropdownMenuPrimitive.Portal
const MenuV2Group = DropdownMenuPrimitive.Group
const MenuV2RadioGroup = DropdownMenuPrimitive.RadioGroup
const MenuV2Sub = DropdownMenuPrimitive.Sub

const MenuV2ContextRoot = ContextMenuPrimitive.Root
const MenuV2ContextTrigger = ContextMenuPrimitive.Trigger
const MenuV2ContextPortal = ContextMenuPrimitive.Portal

const MenuV2ContextContent = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Content>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.Content
    ref={ref}
    data-component="menu-v2-content"
    className={cn(className)}
    {...props}
  />
))
MenuV2ContextContent.displayName = "MenuV2ContextContent"

const MenuV2Context = Object.assign(MenuV2ContextRoot, {
  Trigger: MenuV2ContextTrigger,
  Portal: MenuV2ContextPortal,
  Content: MenuV2ContextContent,
})

export const MenuV2 = Object.assign(MenuV2Root, {
  Trigger: MenuV2Trigger,
  Portal: MenuV2Portal,
  Content: MenuV2Content,
  Item: MenuV2Item,
  CheckboxItem: MenuV2CheckboxItem,
  RadioGroup: MenuV2RadioGroup,
  RadioItem: MenuV2RadioItem,
  Group: MenuV2Group,
  GroupLabel: MenuV2GroupLabel,
  Separator: MenuV2Separator,
  Sub: MenuV2Sub,
  SubTrigger: MenuV2SubTrigger,
  SubContent: MenuV2SubContent,
  Context: MenuV2Context,
})
