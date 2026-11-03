import type { ITheme, ITerminalOptions } from "@xterm/xterm";

/** Font stack: Windows-first, falls back gracefully elsewhere. */
export const TERMINAL_FONT =
  '"Cascadia Mono", "Cascadia Code", Consolas, "JetBrains Mono", "Courier New", monospace';

export type ThemeMode = "dark" | "light";

/** Dark palette tuned for a 24-bit capable renderer. */
export const DARK_TERMINAL_THEME: ITheme = {
  background: "#151b23",
  foreground: "#dbe5ef",
  cursor: "#4ade80",
  cursorAccent: "#151b23",
  selectionBackground: "#2c4a6e80",
  black: "#1c2530",
  red: "#f87171",
  green: "#4ade80",
  yellow: "#fbbf24",
  blue: "#60a5fa",
  magenta: "#c084fc",
  cyan: "#38bdf8",
  white: "#dbe5ef",
  brightBlack: "#6b7c8f",
  brightRed: "#fca5a5",
  brightGreen: "#86efac",
  brightYellow: "#fde68a",
  brightBlue: "#93c5fd",
  brightMagenta: "#d8b4fe",
  brightCyan: "#7dd3fc",
  brightWhite: "#f8fafc",
};

/** Light palette: keeps ANSI colours readable on white. */
export const LIGHT_TERMINAL_THEME: ITheme = {
  background: "#ffffff",
  foreground: "#1f2937",
  cursor: "#16a34a",
  cursorAccent: "#ffffff",
  selectionBackground: "#bfdbfe80",
  black: "#1f2937",
  red: "#dc2626",
  green: "#15803d",
  yellow: "#b45309",
  blue: "#2563eb",
  magenta: "#7c3aed",
  cyan: "#0e7490",
  white: "#e5e7eb",
  brightBlack: "#6b7280",
  brightRed: "#ef4444",
  brightGreen: "#16a34a",
  brightYellow: "#d97706",
  brightBlue: "#3b82f6",
  brightMagenta: "#8b5cf6",
  brightCyan: "#0891b2",
  brightWhite: "#111827",
};

export function terminalTheme(mode: ThemeMode): ITheme {
  return mode === "light" ? LIGHT_TERMINAL_THEME : DARK_TERMINAL_THEME;
}

/** xterm options shared by every terminal session (theme applied per session). */
export const TERMINAL_OPTIONS: ITerminalOptions = {
  fontFamily: TERMINAL_FONT,
  fontSize: 14,
  lineHeight: 1.2,
  letterSpacing: 0,
  cursorBlink: true,
  cursorStyle: "block",
  scrollback: 10_000,
  theme: DARK_TERMINAL_THEME,
  allowTransparency: false,
  convertEol: false,
  macOptionIsMeta: false,
  rightClickSelectsWord: true,
};
