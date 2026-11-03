/** Online editing IPC: temp workspace + save back over SFTP. */

import { Channel, invoke } from "@tauri-apps/api/core";

import { normalizeError } from "./errors";

export interface EditorFile {
  editId: string;
  remotePath: string;
  tempPath: string;
  name: string;
  size: number;
  modified: number | null;
}

export interface EditorSaved {
  remotePath: string;
  size: number;
  modified: number | null;
  consistent: boolean;
  warning: string | null;
}

export interface TempStat {
  size: number;
  mtime: number;
  changed: boolean;
}

export interface EditorProgress {
  transferred: number;
  total: number;
}

/** True while the external editor process is still running. */
export async function processAlive(editId: string): Promise<boolean> {
  try {
    return await invoke<boolean>("editor_process_alive", { editId });
  } catch {
    return false;
  }
}

/** Downloads the remote file and opens it with the Windows default app. */
export async function openEditorExternal(
  terminalId: string,
  remotePath: string,
): Promise<EditorFile> {
  try {
    return await invoke<EditorFile>("editor_open_external", { terminalId, remotePath });
  } catch (error) {
    throw normalizeError(error);
  }
}

/** Whether the temp copy changed since download / the last upload. */
export async function tempStat(editId: string): Promise<TempStat> {
  try {
    return await invoke<TempStat>("editor_temp_stat", { editId });
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function openEditor(terminalId: string, remotePath: string): Promise<EditorFile> {
  try {
    return await invoke<EditorFile>("editor_open", { terminalId, remotePath });
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function saveEditor(
  editId: string,
  onProgress?: (progress: EditorProgress) => void,
): Promise<EditorSaved> {
  const progress = new Channel<EditorProgress>();
  if (onProgress !== undefined) {
    progress.onmessage = onProgress;
  }
  try {
    return await invoke<EditorSaved>("editor_save", { editId, progress });
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function saveEditorAs(editId: string, remotePath: string): Promise<EditorSaved> {
  try {
    return await invoke<EditorSaved>("editor_save_as", { editId, remotePath });
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function closeEditor(editId: string): Promise<void> {
  try {
    await invoke<void>("editor_close", { editId });
  } catch {
    // Closing an editor whose session is gone is not interesting.
  }
}
