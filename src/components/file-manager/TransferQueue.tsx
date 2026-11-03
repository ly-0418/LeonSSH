import { useState } from "react";

import { formatSize } from "./format";
import { formatSpeed, statusLabel, type TransferTask } from "./transferView";

interface TransferQueueProps {
  tasks: TransferTask[];
  speeds: Record<string, number>;
  onCancel: (id: string) => void;
}

export function TransferQueue({ tasks, speeds, onCancel }: TransferQueueProps) {
  const [collapsed, setCollapsed] = useState(false);
  const active = tasks.filter((task) => task.status === "running" || task.status === "queued").length;
  const failed = tasks.filter((task) => task.status === "failed").length;

  return (
    <section className={`fq${collapsed ? " fq--collapsed" : ""}`}>
      <header className="fq__head">
        <button type="button" className="fq__toggle" onClick={() => setCollapsed((value) => !value)}>
          {collapsed ? "▸" : "▾"} 传输队列
        </button>
        <span className="fq__summary">
          {tasks.length === 0
            ? "暂无任务"
            : `${tasks.length} 个任务 · 进行中 ${active}${failed > 0 ? ` · 失败 ${failed}` : ""}`}
        </span>
      </header>

      {!collapsed && tasks.length > 0 && (
        <ul className="fq__list">
          {tasks.map((task) => {
            const percent =
              task.total > 0 ? Math.min(100, Math.round((task.transferred / task.total) * 100)) : null;
            const speed = speeds[task.id] ?? 0;
            return (
              <li key={task.id} className={`fq__item fq__item--${task.status}`}>
                <span className="fq__dir">{task.direction === "upload" ? "↑" : "↓"}</span>
                <span className="fq__name" title={`${task.src} → ${task.dst}`}>
                  {baseName(task.direction === "upload" ? task.src : task.dst)}
                  {task.resumedFrom > 0 && (
                    <span className="fq__resume">续传自 {formatSize(task.resumedFrom)}</span>
                  )}
                  <span className="fq__dst">→ {task.dst}</span>
                </span>
                <span className="fq__bar">
                  <span
                    className="fq__bar-fill"
                    style={{ width: percent === null ? "100%" : `${percent}%` }}
                  />
                </span>
                <span className="fq__bytes">
                  {formatSize(task.transferred)}
                  {task.total > 0 ? ` / ${formatSize(task.total)}` : ""}
                </span>
                <span className="fq__speed">
                  {task.status === "running" && speed > 0 ? formatSpeed(speed) : ""}
                </span>
                <span className="fq__status">{statusLabel(task)}</span>
                {(task.status === "running" || task.status === "queued") && (
                  <button type="button" className="fq__cancel" onClick={() => onCancel(task.id)}>
                    取消
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function baseName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const index = Math.max(trimmed.lastIndexOf("\\"), trimmed.lastIndexOf("/"));
  return index >= 0 ? trimmed.slice(index + 1) : trimmed;
}
