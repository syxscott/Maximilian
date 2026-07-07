import type { Preview } from "@storybook/react"
import { withThemeByClassName } from "@storybook/addon-themes"
import "../packages/ui-react/src/styles/index.css"

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    backgrounds: {
      default: "light",
      values: [
        { name: "light", value: "#ffffff" },
        { name: "dark", value: "#0a0a0a" },
        { name: "warm", value: "#f5f0e8" },
      ],
    },
    layout: "centered",
  },
  decorators: [
    withThemeByClassName({
      themes: {
        light: "theme-light",
        dark: "theme-dark",
      },
      defaultTheme: "light",
    }),
  ],
  tags: ["autodocs"],
}

export default preview