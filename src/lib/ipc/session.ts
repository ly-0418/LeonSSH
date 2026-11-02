/** Typed wrappers around the Tauri commands.
 *
 * Keeping `invoke` behind this module means the terminal code never depends on
 * raw command names or argument shapes, and the whole IPC surface can be
 * swapped (e.g. for a custom URI scheme in a later phase) in one place.
 */

import { Channel, invoke } from "@tauri-apps/api/core";
import { normalizeError } from "./errors";
import type { AppInfo, OpenSessionResult, SessionId } from "./types";

export interface OpenSessionArgs {
  channel: Channel<ArrayBuffer>;
  cols: number;
  rows: number;
  title?: string;
}

export async function openSession(args: OpenSessionArgs): Promise<OpenSessionResult> {
  try {
    return await invoke<OpenSessionResult>("ssh_open", {
      channel: args.channel,
      cols: args.cols,
      rows: args.rows,
      title: args.title ?? null,
    });
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function writeSession(sessionId: SessionId, data: Uint8Array): Promise<void> {
  if (data.byteLength === 0) {
    return;
  }
  try {
    // Keystrokes are tiny; JSON encoding is fine on the input path. The output
    // path is binary and never goes through `invoke`.
    await invoke<void>("ssh_write", { sessionId, data: Array.from(data) });
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function resizeSession(
  sessionId: SessionId,
  cols: number,
  rows: number,
): Promise<void> {
  try {
    await invoke<void>("ssh_resize", { sessionId, cols, rows });
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function closeSession(sessionId: SessionId): Promise<void> {
  try {
    await invoke<void>("ssh_close", { sessionId });
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
