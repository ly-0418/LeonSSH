import type { ITheme, ITerminalOptions } from "@xterm/xterm";

/** Font stack: Windows-first, falls back gracefully elsewhere. */
export const TERMINAL_FONT =
  '"Cascadia Mono", "Cascadia Code", Consolas, "JetBrains Mono", "Courier New", monospace';

/** Dark palette tuned for a 24-bit capable renderer. */
export const LEONSSH_THEME: ITheme = {
  background: "#0b0f14",
  foreground: "#d7e3ee",
  cursor: "#4ade80",
  cursorAccent: "#0b0f14",
  selectionBackground: "#1f3b5780",
  black: "#12181f",
  red: "#f87171",
  green: "#4ade80",
  yellow: "#fbbf24",
  blue: "#60a5fa",
  magenta: "#c084fc",
  cyan: "#38bdf8",
  white: "#d7e3ee",
  brightBlack: "#5c6b7a",
  brightRed: "#fca5a5",
  brightGreen: "#86efac",
  brightYellow: "#fde68a",
  brightBlue: "#93c5fd",
  brightMagenta: "#d8b4fe",
  brightCyan: "#7dd3fc",
  brightWhite: "#f8fafc",
};

/** xterm options shared by every terminal session. */
export const TERMINAL_OPTIONS: ITerminalOptions = {
  fontFamily: TERMINAL_FONT,
  fontSize: 14,
  lineHeight: 1.2,
  letterSpacing: 0,
  cursorBlink: true,
  cursorStyle: "block",
  scrollback: 10_000,
  theme: LEONSSH_THEME,
  allowTransparency: false,
  convertEol: false,
  macOptionIsMeta: false,
  rightClickSelectsWord: true,
};
