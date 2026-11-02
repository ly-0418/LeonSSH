/** Presentation helpers for the transfer queue. */

import type { TransferTask } from "../../lib/ipc/transfers";

export type { TransferTask };

export function statusLabel(task: TransferTask): string {
  if (task.status === "failed" && task.error !== null) {
    return `失败：${task.error}`;
  }
  switch (task.status) {
    case "queued":
      return "等待中";
    case "running":
      return "传输中";
    case "completed":
      return "完成";
    case "cancelled":
      return "已取消";
    case "skipped":
      return "已存在，跳过";
    case "failed":
      return "失败";
    default:
      return task.status;
  }
}

export function formatSpeed(bytesPerSecond: number): string {
  if (bytesPerSecond < 1024) {
    return `${bytesPerSecond.toFixed(0)} B/s`;
  }
  if (bytesPerSecond < 1024 * 1024) {
    return `${(bytesPerSecond / 1024).toFixed(1)} KiB/s`;
  }
  return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MiB/s`;
}
