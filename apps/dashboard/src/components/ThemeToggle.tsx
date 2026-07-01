/**
 * Theme toggle — three-state (system / light / dark) pill button.
 *
 * Cycles through modes on click. Each option has a distinct lucide icon so
 * the current state is visible without opening the Settings tab.
 */

import { Monitor, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme, type ThemeMode } from "@/lib/theme";

const ORDER: ThemeMode[] = ["system", "light", "dark"];

const ICONS = {
  system: Monitor,
  light: Sun,
  dark: Moon,
} as const;

const LABELS = {
  system: "Follow system",
  light: "Light",
  dark: "Dark",
} as const;

export function ThemeToggle() {
  const { mode, setMode } = useTheme();
  const Icon = ICONS[mode];
  const next = ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length]!;

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setMode(next)}
      title={`Theme: ${LABELS[mode]} (click for ${LABELS[next]})`}
      aria-label={`Theme mode: ${LABELS[mode]}`}
      data-testid="theme-toggle"
    >
      <Icon className="h-4 w-4" />
    </Button>
  );
}