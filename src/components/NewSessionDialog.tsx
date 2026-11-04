import { useState } from "react";

import { exportSessionsJson, importSessionsJson } from "../lib/ipc/sessions";
import { toUserMessage } from "../lib/ipc/errors";
import { SessionForm } from "./SessionForm";
import type { SessionSummary } from "../lib/ipc/types";

interface NewSessionDialogProps {
  sessions: SessionSummary[];
  /** Session loaded into the form (null while creating a new one). */
  selected: SessionSummary | null;
  creating: boolean;
  onSelect: (session: SessionSummary) => void;
  onCreate: () => void;
  onDelete: (session: SessionSummary) => void;
  onConnect: (session: SessionSummary) => void;
  onSaved: (session: SessionSummary) => void;
  onSavedAndConnect: (session: SessionSummary) => void;
  onClose: () => void;
  /** Refreshes the session list after an import. */
  onReload?: () => void;
}

/**
 * Single-screen connection manager: the saved sessions on the left, the form on
 * the right. Selecting a session loads it for editing; "新建连接" clears the form.
 */
export function NewSessionDialog({
  sessions,
  selected,
  creating,
  onSelect,
  onCreate,
  onDelete,
  onConnect,
  onSaved,
  onSavedAndConnect,
  onReload,
  onClose,
}: NewSessionDialogProps) {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  async function handleExport() {
    setBusy(true);
    setHint(null);
    try {
      const json = await exportSessionsJson();
      await navigator.clipboard.writeText(json);
      setHint(`已复制 ${JSON.parse(json).length} 个会话到剪贴板`);
    } catch (err) {
      setHint(toUserMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleImport() {
    setBusy(true);
    setHint(null);
    try {
      const json = await navigator.clipboard.readText();
      const count = await importSessionsJson(json);
      setHint(`已导入 ${count} 个会话`);
      onReload?.();
    } catch (err) {
      setHint(toUserMessage(err));
    } finally {
      setBusy(false);
    }
  }
  const keyword = query.trim().toLowerCase();
  const filtered =
    keyword.length === 0
      ? sessions
      : sessions.filter((session) =>
          `${session.name} ${session.username} ${session.host} ${session.group ?? ""}`
            .toLowerCase()
            .includes(keyword),
        );
  return (
    <div className="modal-backdrop" role="presentation">
      <div
        className="modal modal--session"
        role="dialog"
        aria-modal="true"
        aria-label="连接"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="session-dialog__head">
          <div className="session-dialog__titles">
            <h2 className="modal__title">连接</h2>
            <p className="modal__hint">双击左侧已保存的会话即可直接连接；也可以点「新建连接」填写新的服务器信息。</p>
          </div>
          <button type="button" className="modal__close" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </header>

        <div className="session-dialog">
          <aside className="session-dialog__list">
            <button
              type="button"
              className={`session-card session-card--new${creating ? " session-card--active" : ""}`}
              onClick={onCreate}
            >
              <span className="session-card__plus">＋</span>
              新建连接
            </button>

            <input
              className="input session-dialog__search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索会话（名称 / 用户 / 主机 / 分组）"
            />
            <div className="session-dialog__tools">
              <button type="button" className="button button--ghost button--sm" disabled={busy} onClick={() => void handleImport()}>
                导入
              </button>
              <button type="button" className="button button--ghost button--sm" disabled={busy} onClick={() => void handleExport()}>
                导出
              </button>
              {hint !== null && <span className="session-dialog__hint">{hint}</span>}
            </div>
            <div className="session-dialog__scroll">
              {filtered.map((session) => (
                <div
                  key={session.id}
                  className={`session-card${
                    !creating && selected?.id === session.id ? " session-card--active" : ""
                  }`}
                >
                  <button
                    type="button"
                    className="session-card__main"
                    onClick={() => onSelect(session)}
                    onDoubleClick={() => onConnect(session)}
                    title={`${session.username}@${session.host}:${session.port}`}
                  >
                    <span className="session-card__avatar">
                      {session.name.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="session-card__text">
                      <span className="session-card__name">{session.name}</span>
                      <span className="session-card__meta">
                        {session.username}@{session.host}:{session.port}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="session-card__del"
                    title="删除会话"
                    onClick={() => onDelete(session)}
                  >
                    ✕
                  </button>
                </div>
              ))}
              {filtered.length === 0 && sessions.length === 0 && (
                <p className="session-dialog__empty">还没有保存的会话，右侧直接填写即可。</p>
              )}
            </div>
          </aside>

          <section className="session-dialog__form">
            <SessionForm
              key={creating ? "new" : (selected?.id ?? "new")}
              sessions={sessions}
              initial={creating ? null : selected}
              onboarding={false}
              onSaved={onSaved}
              onSavedAndConnect={onSavedAndConnect}
            />
          </section>
        </div>
      </div>
    </div>
  );
}
