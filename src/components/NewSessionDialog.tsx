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
  onSaved: (session: SessionSummary) => void;
  onSavedAndConnect: (session: SessionSummary) => void;
  onClose: () => void;
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
  onSaved,
  onSavedAndConnect,
  onClose,
}: NewSessionDialogProps) {
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
            <p className="modal__hint">选择左侧已保存的会话，或新建一个连接。</p>
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

            <div className="session-dialog__scroll">
              {sessions.map((session) => (
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
              {sessions.length === 0 && (
                <p className="session-dialog__empty">还没有保存的会话，右侧直接填写即可。</p>
              )}
            </div>
          </aside>

          <section className="session-dialog__form">
            <SessionForm
              key={creating ? "new" : (selected?.id ?? "new")}
              initial={creating ? null : selected}
              onboarding={false}
              onSaved={onSaved}
              onSavedAndConnect={onSavedAndConnect}
              onCancel={onClose}
            />
          </section>
        </div>
      </div>
    </div>
  );
}
