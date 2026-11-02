import type { SessionSummary } from "../lib/ipc/types";

export type WorkspaceView = "terminal" | "files";

interface SidebarProps {
  view: WorkspaceView;
  onChangeView: (view: WorkspaceView) => void;
  sessions: SessionSummary[];
  activeSessionId: number | null;
  onOpen: (session: SessionSummary) => void;
  onCreate: () => void;
  onEdit: (session: SessionSummary) => void;
  onDelete: (session: SessionSummary) => void;
  onShowKnownHosts: () => void;
}

export function Sidebar({
  view,
  onChangeView,
  sessions,
  activeSessionId,
  onOpen,
  onCreate,
  onEdit,
  onDelete,
  onShowKnownHosts,
}: SidebarProps) {
  return (
    <aside className="sidebar">
      <nav className="sidebar__nav">
        <button
          type="button"
          className={`sidebar__navbtn${view === "terminal" ? " sidebar__navbtn--active" : ""}`}
          onClick={() => onChangeView("terminal")}
        >
          终端
        </button>
        <button
          type="button"
          className={`sidebar__navbtn${view === "files" ? " sidebar__navbtn--active" : ""}`}
          onClick={() => onChangeView("files")}
        >
          文件管理
        </button>
      </nav>

      <div className="sidebar__head">
        <span className="sidebar__title">会话</span>
        <button type="button" className="button button--primary button--sm" onClick={onCreate}>
          + 新建
        </button>
      </div>

      <ul className="session-list">
        {sessions.map((session) => (
          <li
            key={session.id}
            className={`session-item${session.id === activeSessionId ? " session-item--active" : ""}`}
          >
            <button type="button" className="session-item__main" onClick={() => onOpen(session)}>
              <span
                className="session-item__dot"
                style={{ backgroundColor: session.color ?? "#4ade80" }}
              />
              <span className="session-item__text">
                <span className="session-item__name">{session.name}</span>
                <span className="session-item__meta">
                  {session.username}@{session.host}:{session.port}
                  {session.hasPassword ? "" : " · 缺密码"}
                </span>
              </span>
            </button>
            <span className="session-item__actions">
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

      {sessions.length === 0 && <p className="sidebar__empty">还没有会话，先创建一个。</p>}

      <div className="sidebar__foot">
        <button type="button" className="button button--ghost button--sm" onClick={onShowKnownHosts}>
          已知主机 ({sessions.length > 0 ? "管理" : "查看"})
        </button>
      </div>
    </aside>
  );
}
