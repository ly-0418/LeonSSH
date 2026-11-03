import { useEffect, useState } from "react";

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
  onDuplicate: (key: string) => void;
  onShowKnownHosts: () => void;
  forwardOpen: boolean;
  onToggleForward: () => void;
}

interface MenuState {
  x: number;
  y: number;
  key: string;
}

export function TabBar({
  tabs,
  activeKey,
  onActivate,
  onClose,
  onNewSession,
  onDuplicate,
  onShowKnownHosts,
  forwardOpen,
  onToggleForward,
}: TabBarProps) {
  const [menu, setMenu] = useState<MenuState | null>(null);

  useEffect(() => {
    if (menu === null) {
      return;
    }
    const close = () => setMenu(null);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
      }
    };
    window.addEventListener("click", close);
    window.addEventListener("contextmenu", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

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
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onActivate(tab.key);
            setMenu({ x: event.clientX, y: event.clientY, key: tab.key });
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
        className="tab-bar__action"
        onClick={onShowKnownHosts}
        title="已知主机（主机密钥指纹）"
      >
        主机
      </button>
      <button
        type="button"
        className={`tab-bar__action${forwardOpen ? " tab-bar__action--active" : ""}`}
        onClick={onToggleForward}
        disabled={activeKey === null}
        title="端口转发（-L / -R / -D）"
      >
        转发
      </button>

      {menu !== null && (
        <div
          className="tab-menu"
          style={{ left: menu.x, top: menu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className="tab-menu__item"
            onClick={() => {
              onDuplicate(menu.key);
              setMenu(null);
            }}
          >
            复制连接到新会话
          </button>
        </div>
      )}
    </div>
  );
}
