/** SFTP and local filesystem IPC. */

import { Channel, invoke } from "@tauri-apps/api/core";

import { normalizeError } from "./errors";

export interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
  isSymlink: boolean;
  size: number;
  modified: number | null;
  permissions: number | null;
}

export interface TransferProgress {
  transferred: number;
  total: number;
  done: boolean;
  message: string | null;
}

export function parentPath(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const index = trimmed.lastIndexOf("/");
  if (index <= 0) {
    return "/";
  }
  return trimmed.slice(0, index);
}

export function joinPath(dir: string, name: string): string {
  return dir.endsWith("/") ? `${dir}${name}` : `${dir}/${name}`;
}

export async function openSftp(terminalId: string): Promise<string> {
  try {
    return await invoke<string>("sftp_open", { terminalId });
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function closeSftp(terminalId: string): Promise<void> {
  try {
    await invoke<void>("sftp_close", { terminalId });
  } catch {
    // Closing an already-closed subsystem is not interesting.
  }
}

export async function listRemote(terminalId: string, path: string): Promise<FileEntry[]> {
  try {
    return await invoke<FileEntry[]>("sftp_list", { terminalId, path });
  } catch (error) {
    throw normalizeError(error);
  }
}

/** Metadata for one remote path (throws when it does not exist). */
export async function statRemote(terminalId: string, path: string): Promise<FileEntry> {
  try {
    return await invoke<FileEntry>("sftp_stat", { terminalId, path });
  } catch (error) {
    throw normalizeError(error);
  }
}

/** Streams a directory listing; `onBatch` is called as each batch arrives. */
export async function listRemoteStream(
  terminalId: string,
  path: string,
  onBatch: (entries: FileEntry[]) => void,
): Promise<number> {
  const batch = new Channel<FileEntry[]>();
  batch.onmessage = (entries) => onBatch(entries);
  try {
    return await invoke<number>("sftp_list_stream", { terminalId, path, batch });
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function mkdirRemote(terminalId: string, path: string): Promise<void> {
  try {
    await invoke<void>("sftp_mkdir", { terminalId, path });
  } catch (error) {
    throw normalizeError(error);
  }
}

/** Creates an empty remote file. */
export async function createRemoteFile(terminalId: string, path: string): Promise<void> {
  try {
    await invoke<void>("sftp_create_file", { terminalId, path });
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function removeRemote(
  terminalId: string,
  path: string,
  isDir: boolean,
): Promise<void> {
  try {
    await invoke<void>("sftp_remove", { terminalId, path, isDir });
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function renameRemote(
  terminalId: string,
  from: string,
  to: string,
): Promise<void> {
  try {
    await invoke<void>("sftp_rename", { terminalId, from, to });
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function chmodRemote(
  terminalId: string,
  path: string,
  mode: number,
): Promise<void> {
  try {
    await invoke<void>("sftp_chmod", { terminalId, path, mode });
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function uploadFile(
  terminalId: string,
  localPath: string,
  remotePath: string,
  onProgress: (progress: TransferProgress) => void,
): Promise<void> {
  const progress = new Channel<TransferProgress>();
  progress.onmessage = onProgress;
  try {
    await invoke<void>("sftp_upload", { terminalId, localPath, remotePath, progress });
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function downloadFile(
  terminalId: string,
  remotePath: string,
  localPath: string,
  onProgress: (progress: TransferProgress) => void,
): Promise<void> {
  const progress = new Channel<TransferProgress>();
  progress.onmessage = onProgress;
  try {
    await invoke<void>("sftp_download", { terminalId, remotePath, localPath, progress });
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function localHome(): Promise<string> {
  try {
    return await invoke<string>("local_home");
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function listLocal(path: string): Promise<FileEntry[]> {
  try {
    return await invoke<FileEntry[]>("local_list", { path });
  } catch (error) {
    throw normalizeError(error);
  }
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KiB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
}

export function formatMode(mode: number | null): string {
  if (mode === null) {
    return "—";
  }
  return (mode & 0o777).toString(8).padStart(3, "0");
}
