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

/** Human readable elapsed time, e.g. "1分 05秒". */
export function formatDuration(startedAt: number, finishedAt: number | null): string {
  const nowSecs = Math.floor(Date.now() / 1000);
  const end = finishedAt ?? nowSecs;
  const total = Math.max(0, end - startedAt);
  if (total < 60) {
    return `${total} 秒`;
  }
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes < 60) {
    return `${minutes} 分 ${String(seconds).padStart(2, "0")} 秒`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours} 小时 ${String(minutes % 60).padStart(2, "0")} 分`;
}