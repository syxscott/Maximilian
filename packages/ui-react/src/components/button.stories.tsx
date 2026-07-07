import type { Meta, StoryObj } from "@storybook/react"
import { Button } from "./button"

const meta: Meta<typeof Button> = {
  title: "Components/Button",
  component: Button,
  tags: ["autodocs"],
  argTypes: {
    variant: {
      control: { type: "select" },
      options: ["primary", "secondary", "ghost"],
    },
    size: {
      control: { type: "select" },
      options: ["small", "normal", "large"],
    },
    disabled: { control: "boolean" },
  },
  args: {
    children: "Click me",
    variant: "primary",
    size: "normal",
    disabled: false,
  },
}

export default meta
type Story = StoryObj<typeof Button>

export const Primary: Story = {}
export const Secondary: Story = { args: { variant: "secondary" } }
export const Ghost: Story = { args: { variant: "ghost" } }
export const Small: Story = { args: { size: "small" } }
export const Large: Story = { args: { size: "large" } }
export const Disabled: Story = { args: { disabled: true } }