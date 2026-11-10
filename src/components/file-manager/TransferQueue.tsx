import { useMemo, useState } from "react";

import { formatSize } from "./format";
import { formatDuration, formatSpeed, statusLabel, type TransferTask } from "./transferView";

interface TransferQueueProps {
  tasks: TransferTask[];
  /** Only this session's transfers are listed; others keep running in background. */
  terminalId: string;
  speeds: Record<string, number>;
  /** Height in pixels (adjusted by the splitter above the queue). */
  height: number;
  onCancel: (id: string) => void;
}

type QueueTab = "active" | "done" | "failed";

const DONE_STATES = new Set(["completed", "skipped", "cancelled"]);

export function TransferQueue({ tasks, terminalId, speeds, height, onCancel }: TransferQueueProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [tab, setTab] = useState<QueueTab>("active");

  const groups = useMemo(() => {
    const mine = tasks.filter((task) => task.terminalId === terminalId);
    const active = mine.filter((task) => task.status === "running" || task.status === "queued");
    const done = mine.filter((task) => DONE_STATES.has(task.status));
    const failed = mine.filter((task) => task.status === "failed");
    const others = tasks.filter((task) => task.terminalId !== terminalId).length;
    return { active, done, failed, others };
  }, [tasks, terminalId]);

  const visible = tab === "active" ? groups.active : tab === "done" ? groups.done : groups.failed;

  return (
    <section
      className={`fq${collapsed ? " fq--collapsed" : ""}`}
      style={{ height: collapsed ? 30 : height }}
    >
      <header className="fq__head">
        <button type="button" className="fq__toggle" onClick={() => setCollapsed((value) => !value)}>
          {collapsed ? "▸" : "▾"} 传输队列
        </button>

        <div className="fq__tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "active"}
            className={`fq__tab${tab === "active" ? " fq__tab--active" : ""}`}
            onClick={() => {
              setTab("active");
              setCollapsed(false);
            }}
          >
            进行中 {groups.active.length}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "done"}
            className={`fq__tab${tab === "done" ? " fq__tab--active" : ""}`}
            onClick={() => {
              setTab("done");
              setCollapsed(false);
            }}
          >
            已完成 {groups.done.length}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "failed"}
            className={`fq__tab${tab === "failed" ? " fq__tab--active" : ""}${
              groups.failed.length > 0 ? " fq__tab--alert" : ""
            }`}
            onClick={() => {
              setTab("failed");
              setCollapsed(false);
            }}
          >
            失败 {groups.failed.length}
          </button>
        </div>

        {groups.others > 0 && (
          <span className="fq__others" title="其它会话的传输仍在后台运行，切回对应会话即可查看">
            其它会话 {groups.others} 个传输
          </span>
        )}
        <span className="fq__summary">
          {tasks.length === 0 ? "暂无任务" : `${tasks.length} 个任务`}
        </span>
      </header>

      {!collapsed && (
        <ul className="fq__list">
          {visible.length === 0 && (
            <li className="fq__empty">
              {tab === "active" ? "没有进行中的传输" : tab === "done" ? "还没有已完成的传输" : "没有失败的传输"}
            </li>
          )}

          {visible.map((task) => {
            const percent =
              task.total > 0 ? Math.min(100, Math.round((task.transferred / task.total) * 100)) : null;
            const speed = speeds[task.id] ?? 0;
            const failed = task.status === "failed";
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
                <span className="fq__time">{formatDuration(task.startedAt, task.finishedAt)}</span>
                <span className="fq__status">{statusLabel(task)}</span>
                {/* Always rendered so the grid keeps its column count while a
                    task is queued/running (the cancel button used to wrap). */}
                <span className="fq__actions">
                  {(task.status === "running" || task.status === "queued") && (
                    <button type="button" className="fq__cancel" onClick={() => onCancel(task.id)}>
                      取消
                    </button>
                  )}
                </span>
                {failed && task.error !== null && (
                  <span className="fq__error" title={task.error}>
                    失败原因：{task.error}
                  </span>
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
