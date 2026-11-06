import { useCallback, useEffect, useRef, useState } from "react";

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
  forwardOpen: boolean;
  onToggleForward: () => void;
  broadcast: boolean;
  onToggleBroadcast: () => void;
  /** Settings → 配置参数: hide the two action buttons. */
  showBroadcast?: boolean;
  showForward?: boolean;
  onReconnect: (key: string) => void;
  onDisconnect: (key: string) => void;
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
  forwardOpen,
  onToggleForward,
  broadcast,
  onToggleBroadcast,
  showBroadcast = false,
  showForward = false,
  onReconnect,
  onDisconnect,
}: TabBarProps) {
  const [menu, setMenu] = useState<MenuState | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const syncArrows = useCallback(() => {
    const element = scrollRef.current;
    if (element === null) {
      return;
    }
    setCanScrollLeft(element.scrollLeft > 2);
    setCanScrollRight(element.scrollLeft + element.clientWidth < element.scrollWidth - 2);
  }, []);

  useEffect(() => {
    syncArrows();
    const element = scrollRef.current;
    if (element === null) {
      return;
    }
    element.addEventListener("scroll", syncArrows, { passive: true });
    const observer = new ResizeObserver(syncArrows);
    observer.observe(element);
    return () => {
      element.removeEventListener("scroll", syncArrows);
      observer.disconnect();
    };
  }, [syncArrows, tabs.length]);

  const scrollTabs = (direction: number) => {
    scrollRef.current?.scrollBy({ left: direction * 220, behavior: "smooth" });
  };

  // A new tab should be visible immediately: scroll the strip to the end.
  useEffect(() => {
    const element = scrollRef.current;
    if (element === null) {
      return;
    }
    // Scroll smoothly to the newest tab once its layout is in place.
    let inner = 0;
    const frame = window.requestAnimationFrame(() => {
      syncArrows();
      inner = window.requestAnimationFrame(() => {
        element.scrollTo({ left: element.scrollWidth, behavior: "smooth" });
      });
    });
    return () => {
      window.cancelAnimationFrame(frame);
      window.cancelAnimationFrame(inner);
    };
  }, [tabs.length, syncArrows]);

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
      <div
        className="tab-bar__strip"
        data-overflow={canScrollLeft || canScrollRight ? "true" : "false"}
        data-fade-left={canScrollLeft ? "true" : "false"}
        data-fade-right={canScrollRight ? "true" : "false"}
      >
        <button
          type="button"
          className="tab-bar__arrow tab-bar__arrow--left"
          title="向左滚动标签"
          aria-label="向左滚动标签"
          disabled={!canScrollLeft}
          onClick={() => scrollTabs(-1)}
        >
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m15 5-7 7 7 7" />
          </svg>
        </button>
        <div
          className={`tab-bar__scroll${canScrollLeft ? " tab-bar__scroll--fade-left" : ""}${canScrollRight ? " tab-bar__scroll--fade-right" : ""}`}
          ref={scrollRef}
        >
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
            title="关闭会话"
            aria-label="关闭会话"
            onClick={(event) => {
              event.stopPropagation();
              onClose(tab.key);
            }}
          >
            ✕
          </button>
        </div>
      ))}

        </div>
        <button
          type="button"
          className="tab-bar__arrow tab-bar__arrow--right"
          title="向右滚动标签"
          aria-label="向右滚动标签"
          disabled={!canScrollRight}
          onClick={() => scrollTabs(1)}
        >
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m9 5 7 7-7 7" />
          </svg>
        </button>
      </div>

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
      {showBroadcast && (
      <button
        type="button"
        className={`tab-bar__action${broadcast ? " tab-bar__action--active" : ""}`}
        onClick={onToggleBroadcast}
        title="广播输入：在多个会话之间同步键入"
      >
        广播
      </button>
      )}
      {showForward && (
      <button
        type="button"
        className={`tab-bar__action${forwardOpen ? " tab-bar__action--active" : ""}`}
        onClick={onToggleForward}
        disabled={activeKey === null}
        title="端口转发（-L / -R / -D）"
      >
        转发
      </button>
      )}

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
              onClose(menu.key);
              setMenu(null);
            }}
          >
            <span className="tab-menu__icon">{"\uE711"}</span>
            关闭会话
          </button>
                    {(() => {
              const target = tabs.find((tab) => tab.key === menu.key);
              const connected = target !== undefined && target.status.terminalId !== null;
              return connected ? (
                <button
                  type="button"
                  className="tab-menu__item"
                  onClick={() => {
                    onDisconnect(menu.key);
                    setMenu(null);
                  }}
                >
                  <span className="tab-menu__icon">{"\uE8CD"}</span>
                  断开连接
                </button>
              ) : (
                <button
                  type="button"
                  className="tab-menu__item"
                  onClick={() => {
                    onReconnect(menu.key);
                    setMenu(null);
                  }}
                >
                  <span className="tab-menu__icon">{"\uE72C"}</span>
                  重新连接
                </button>
              );
            })()}
          <button
            type="button"
            className="tab-menu__item"
            onClick={() => {
              onDuplicate(menu.key);
              setMenu(null);
            }}
          >
            <span className="tab-menu__icon">{"\uE8C8"}</span>
            复制连接到新会话
          </button>
        </div>
      )}
    </div>
  );
}
