/** Transfer queue IPC: uploads, downloads, progress events, cancellation. */

import { Channel, invoke } from "@tauri-apps/api/core";

import { normalizeError } from "./errors";

export type TransferDirection = "upload" | "download";
export type TransferStatus =
  | "queued"
  | "running"
  | "completed"
  | "cancelled"
  | "failed"
  | "skipped";

export interface TransferTask {
  id: string;
  terminalId: string;
  direction: TransferDirection;
  src: string;
  dst: string;
  total: number;
  transferred: number;
  resumedFrom: number;
  status: TransferStatus;
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
}

/** Registers the global progress channel (one per window is enough). */
export function attachTransfers(channel: Channel<TransferTask>): Promise<void> {
  return invoke<void>("transfer_attach", { channel });
}

export async function listTransfers(): Promise<TransferTask[]> {
  try {
    return await invoke<TransferTask[]>("transfer_list");
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function cancelTransfer(id: string): Promise<void> {
  try {
    await invoke<void>("transfer_cancel", { id });
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function startUpload(
  terminalId: string,
  localPath: string,
  remotePath: string,
  overwrite = false,
): Promise<TransferTask> {
  try {
    return await invoke<TransferTask>("transfer_upload", {
      terminalId,
      localPath,
      remotePath,
      overwrite,
    });
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function startDownload(
  terminalId: string,
  remotePath: string,
  localPath: string,
): Promise<TransferTask> {
  try {
    return await invoke<TransferTask>("transfer_download", {
      terminalId,
      remotePath,
      localPath,
    });
  } catch (error) {
    throw normalizeError(error);
  }
}

export function isActive(task: TransferTask): boolean {
  return task.status === "queued" || task.status === "running";
}

/** Recursively uploads a local directory, queueing one task per file. */
export async function startUploadDir(
  terminalId: string,
  localPath: string,
  remotePath: string,
): Promise<number> {
  try {
    return await invoke<number>("transfer_upload_dir", { terminalId, localPath, remotePath });
  } catch (error) {
    throw normalizeError(error);
  }
}
/** Recursively downloads a remote directory, queueing one task per file. */
export async function startDownloadDir(
  terminalId: string,
  remotePath: string,
  localPath: string,
): Promise<number> {
  try {
    return await invoke<number>("transfer_download_dir", { terminalId, remotePath, localPath });
  } catch (error) {
    throw normalizeError(error);
  }
}