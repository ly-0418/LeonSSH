import type { TerminalStatus } from "../lib/ipc/types";

export interface TabItem {
  key: string;
  sessionId: number;
  title: string;
  status: TerminalStatus;
}

const STATE_DOT: Record<string, string> = {
  connecting: "tab__dot tab__dot--connecting",
  ready: "tab__dot tab__dot--ready",
  error: "tab__dot tab__dot--error",
  closed: "tab__dot tab__dot--closed",
};

interface TabBarProps {
  tabs: TabItem[];
  activeKey: string | null;
  onActivate: (key: string) => void;
  onClose: (key: string) => void;
  onNewSession: () => void;
  forwardOpen: boolean;
  onToggleForward: () => void;
}

export function TabBar({
  tabs,
  activeKey,
  onActivate,
  onClose,
  onNewSession,
  forwardOpen,
  onToggleForward,
}: TabBarProps) {
  return (
    <div className="tab-bar" role="tablist">
      {tabs.map((tab) => (
        <div
          key={tab.key}
          role="tab"
          aria-selected={tab.key === activeKey}
          className={`tab${tab.key === activeKey ? " tab--active" : ""}`}
          onClick={() => onActivate(tab.key)}
          onAuxClick={(event) => {
            if (event.button === 1) {
              onClose(tab.key);
            }
          }}
        >
          <span className={STATE_DOT[tab.status.state] ?? STATE_DOT.closed} />
          <span className="tab__title" title={tab.status.endpoint ?? tab.title}>
            {tab.title}
          </span>
          <button
            type="button"
            className="tab__close"
            title="关闭标签"
            aria-label="关闭标签"
            onClick={(event) => {
              event.stopPropagation();
              onClose(tab.key);
            }}
          >
            ✕
          </button>
        </div>
      ))}

      <button
        type="button"
        className="tab-bar__new"
        title="新建连接（选择已保存的会话或新建）"
        aria-label="新建连接"
        onClick={onNewSession}
      >
        ＋
      </button>

      <span className="tab-bar__spacer" />
      <button
        type="button"
        className={`tab-bar__action${forwardOpen ? " tab-bar__action--active" : ""}`}
        onClick={onToggleForward}
        disabled={activeKey === null}
        title="端口转发（-L / -R / -D）"
      >
        转发
      </button>
    </div>
  );
}
