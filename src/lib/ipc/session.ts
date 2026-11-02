/** Typed wrappers around the terminal commands.
 *
 * Keeping `invoke` behind this module means the terminal code never depends on
 * raw command names or argument shapes, and the whole IPC surface can be
 * swapped (e.g. for a custom URI scheme later) in one place.
 */

import { Channel, invoke } from "@tauri-apps/api/core";
import { normalizeError } from "./errors";
import type { AppInfo, OpenTerminalResult, TerminalId } from "./types";

export interface OpenTerminalArgs {
  /** Row id of the stored connection profile. */
  sessionId: number;
  channel: Channel<ArrayBuffer>;
  cols: number;
  rows: number;
}

export async function openTerminal(args: OpenTerminalArgs): Promise<OpenTerminalResult> {
  try {
    return await invoke<OpenTerminalResult>("ssh_open", {
      sessionId: args.sessionId,
      channel: args.channel,
      cols: args.cols,
      rows: args.rows,
    });
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function writeTerminal(terminalId: TerminalId, data: Uint8Array): Promise<void> {
  if (data.byteLength === 0) {
    return;
  }
  try {
    // Keystrokes are tiny; JSON encoding is fine on the input path. The output
    // path is binary and never goes through `invoke`.
    await invoke<void>("ssh_write", { terminalId, data: Array.from(data) });
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function resizeTerminal(
  terminalId: TerminalId,
  cols: number,
  rows: number,
): Promise<void> {
  try {
    await invoke<void>("ssh_resize", { terminalId, cols, rows });
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function closeTerminal(terminalId: TerminalId): Promise<void> {
  try {
    await invoke<void>("ssh_close", { terminalId });
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function fetchAppInfo(): Promise<AppInfo> {
  try {
    return await invoke<AppInfo>("app_info");
  } catch (error) {
    throw normalizeError(error);
  }
}
