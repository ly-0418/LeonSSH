/** Cursor configuration shared by the settings UI and the renderer.
 *
 * The three animation fields are additive: they never replace the existing
 * shape/width options, they only decorate the caret drawn by xterm.
 */

export type CursorShape = "bar" | "underline";

/** Visual caret movement style (IntelliJ IDEA 2026.1 parity). */
export type SmoothMoveMode = "off" | "snappy" | "gliding";

export interface CursorConfig {
  shape: CursorShape;
  /** Caret thickness in CSS pixels (bar only). */
  width: number;
  /** Fade the caret in/out instead of hard blinking. */
  smoothBlink: boolean;
  /** Corner radius of the custom caret, in pixels. */
  blinkRadius: number;
  /** Interpolate the caret between cells. */
  smoothMove: SmoothMoveMode;
}

export const DEFAULT_CURSOR_CONFIG: CursorConfig = {
  shape: "bar",
  width: 2,
  smoothBlink: false,
  blinkRadius: 2,
  smoothMove: "off",
};

export const SMOOTH_MOVE_OPTIONS: Array<{ value: SmoothMoveMode; label: string }> = [
  { value: "off", label: "关闭" },
  { value: "snappy", label: "Snappy（利落缓停）" },
  { value: "gliding", label: "Gliding（滑翔滑动）" },
];

/** True when the custom overlay must take over from xterm's native cursor. */
export function cursorAnimationActive(config: CursorConfig): boolean {
  return config.smoothBlink || config.smoothMove !== "off";
}

export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function linear(t: number): number {
  return t;
}
