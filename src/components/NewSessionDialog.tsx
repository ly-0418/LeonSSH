import { useState } from "react";

import { SessionForm } from "./SessionForm";
import type { SessionSummary } from "../lib/ipc/types";

interface NewSessionDialogProps {
  sessions: SessionSummary[];
  /** Start on the form (edit/new) instead of the saved-session list. */
  startInForm?: boolean;
  editing: SessionSummary | null;
  onPick: (session: SessionSummary) => void;
  onSaved: (session: SessionSummary) => void;
  onEdit: (session: SessionSummary) => void;
  onDelete: (session: SessionSummary) => void;
  onClose: () => void;
}

/**
 * Tab-bar "+" dialog: pick an already saved connection, create a new one, or
 * edit/delete an existing profile (the sidebar is gone, so this is the only
 * place for those actions).
 */
export function NewSessionDialog({
  sessions,
  startInForm = false,
  editing,
  onPick,
  onSaved,
  onEdit,
  onDelete,
  onClose,
}: NewSessionDialogProps) {
  const [showForm, setShowForm] = useState(startInForm || sessions.length === 0);

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal modal--wide"
        role="dialog"
        aria-modal="true"
        aria-label="新建连接"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="new-session__head">
          <h2 className="modal__title">{showForm ? (editing === null ? "新建连接" : "编辑会话") : "选择会话"}</h2>
          <button type="button" className="modal__close" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </header>

        {showForm ? (
          <SessionForm
            key={editing?.id ?? "new"}
            initial={editing}
            onboarding={false}
            onSaved={(session) => {
              onSaved(session);
            }}
            onCancel={() => {
              if (sessions.length === 0) {
                onClose();
              } else {
                setShowForm(false);
              }
            }}
          />
        ) : (
          <>
            <ul className="new-session__list">
              {sessions.map((session) => (
                <li key={session.id} className="new-session__row">
                  <button
                    type="button"
                    className="new-session__item"
                    onClick={() => onPick(session)}
                  >
                    <span className="new-session__dot" data-color={session.color ?? ""} />
                    <span className="new-session__name">{session.name}</span>
                    <span className="new-session__target">
                      {session.username}@{session.host}:{session.port}
                    </span>
                  </button>
                  <span className="new-session__actions">
                    <button type="button" title="编辑" onClick={() => onEdit(session)}>
                      ✎
                    </button>
                    <button type="button" title="删除" onClick={() => onDelete(session)}>
                      ✕
                    </button>
                  </span>
                </li>
              ))}
            </ul>
            <div className="modal__actions">
              <button type="button" className="button button--primary" onClick={() => setShowForm(true)}>
                ＋ 新建连接
              </button>
              <button type="button" className="button button--ghost" onClick={onClose}>
                取消
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
