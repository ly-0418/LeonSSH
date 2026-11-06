import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { BroadcastIcon, ForwardIcon } from "./icons";
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
  /** Drag a tab onto another one to move it there. */
  onReorder: (fromKey: string, toKey: string) => void;
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

/** Threshold before a press turns into a tab drag. */
const DRAG_THRESHOLD = 6;
/** Ignore further swaps for this long after one, preventing boundary jitter. */
const SWAP_COOLDOWN_MS = 320;

export function TabBar({
  tabs,
  activeKey,
  onActivate,
  onClose,
  onNewSession,
  onDuplicate,
  onReorder,
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
  const [draggingKey, setDraggingKey] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  // HTML5 drag-and-drop is unreliable inside WebView2, so tabs are reordered by
  // tracking the pointer ourselves (same approach as the file manager).
  const tabRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const dragRef = useRef<{ key: string; startX: number; startY: number; active: boolean } | null>(null);
  const suppressClickRef = useRef(false);
  const flipRef = useRef<Map<string, DOMRect> | null>(null);
  const nextSwapAtRef = useRef(0);
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const grabOffsetRef = useRef({ x: 0, y: 0 });
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const onReorderRef = useRef(onReorder);
  onReorderRef.current = onReorder;

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

  /** FLIP: record where every tab sits before the order changes. */
  const snapshotTabs = () => {
    const snapshot = new Map<string, DOMRect>();
    tabRefs.current.forEach((element, key) => {
      snapshot.set(key, element.getBoundingClientRect());
    });
    flipRef.current = snapshot;
  };

  // Animate the tabs into their new slots after a reorder.
  useLayoutEffect(() => {
    const previous = flipRef.current;
    flipRef.current = null;
    if (previous === null) {
      return;
    }
    previous.forEach((before, key) => {
      const element = tabRefs.current.get(key);
      if (element === undefined) {
        return;
      }
      const after = element.getBoundingClientRect();
      const delta = before.left - after.left;
      if (Math.abs(delta) < 1) {
        return;
      }
      element.style.transition = "none";
      element.style.transform = `translateX(${delta}px)`;
      void element.offsetWidth;
      element.style.transition = "transform 320ms cubic-bezier(0.22, 0.61, 0.36, 1)";
      element.style.transform = "";
      const clear = () => {
        element.style.transition = "";
        element.removeEventListener("transitionend", clear);
      };
      element.addEventListener("transitionend", clear);
    });
  }, [tabs]);

  // Pointer-driven reorder: a clone follows the cursor, the source becomes a
  // placeholder, and dragging near an edge auto-scrolls the strip.
  useEffect(() => {
    const lastPos = { x: 0, y: 0 };
    let scrollDir = 0;
    let frame = 0;

    const evaluate = () => {
      const state = dragRef.current;
      if (state === null || !state.active) {
        return;
      }
      const ghost = ghostRef.current;
      if (ghost !== null) {
        ghost.style.left = `${lastPos.x - grabOffsetRef.current.x}px`;
        ghost.style.top = `${lastPos.y - grabOffsetRef.current.y}px`;
      }
      const element = document.elementFromPoint(lastPos.x, lastPos.y);
      const target = element instanceof Element ? element.closest<HTMLElement>("[data-tab-key]") : null;
      if (target === null) {
        return;
      }
      const targetKey = target.dataset.tabKey ?? null;
      if (targetKey === null || targetKey === state.key) {
        return;
      }
      const list = tabsRef.current;
      const fromIndex = list.findIndex((tab) => tab.key === state.key);
      const toIndex = list.findIndex((tab) => tab.key === targetKey);
      if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
        return;
      }
      // Hysteresis: only swap once the pointer is clearly past the middle of the
      // hovered tab, and never more often than the cooldown allows.
      const now = Date.now();
      if (now < nextSwapAtRef.current) {
        return;
      }
      const rect = target.getBoundingClientRect();
      const centre = rect.left + rect.width / 2;
      const movingRight = toIndex > fromIndex;
      if (movingRight
        ? lastPos.x < centre + rect.width * 0.08
        : lastPos.x > centre - rect.width * 0.08) {
        return;
      }
      nextSwapAtRef.current = now + SWAP_COOLDOWN_MS;
      snapshotTabs();
      onReorderRef.current(state.key, targetKey);
    };

    const tick = () => {
      const element = scrollRef.current;
      if (element !== null && scrollDir !== 0) {
        element.scrollLeft += scrollDir * 14;
        evaluate();
      }
      if (dragRef.current?.active === true) {
        frame = window.requestAnimationFrame(tick);
      }
    };

    const move = (event: PointerEvent) => {
      lastPos.x = event.clientX;
      lastPos.y = event.clientY;
      const state = dragRef.current;
      if (state === null) {
        return;
      }
      if (!state.active) {
        const travelled = Math.hypot(event.clientX - state.startX, event.clientY - state.startY);
        if (travelled < DRAG_THRESHOLD) {
          return;
        }
        state.active = true;
        setDraggingKey(state.key);
        const source = tabRefs.current.get(state.key);
        if (source !== undefined) {
          const rect = source.getBoundingClientRect();
          grabOffsetRef.current = {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
          };
          const clone = source.cloneNode(true) as HTMLDivElement;
          clone.classList.add("tab--ghost");
          clone.style.width = `${rect.width}px`;
          clone.style.height = `${rect.height}px`;
          clone.style.left = `${rect.left}px`;
          clone.style.top = `${rect.top}px`;
          document.body.appendChild(clone);
          ghostRef.current = clone;
        }
        window.cancelAnimationFrame(frame);
        frame = window.requestAnimationFrame(tick);
      }

      // Auto-scroll when the pointer nears either edge of the strip.
      scrollDir = 0;
      const scroller = scrollRef.current;
      if (scroller !== null) {
        const rect = scroller.getBoundingClientRect();
        const EDGE = 48;
        if (event.clientX <= rect.left + EDGE) {
          scrollDir = -1;
        } else if (event.clientX >= rect.right - EDGE) {
          scrollDir = 1;
        }
        if (scrollDir === -1 && scroller.scrollLeft <= 0) {
          scrollDir = 0;
        }
        if (
          scrollDir === 1 &&
          scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 1
        ) {
          scrollDir = 0;
        }
      }

      evaluate();
    };

    const up = () => {
      scrollDir = 0;
      window.cancelAnimationFrame(frame);
      ghostRef.current?.remove();
      ghostRef.current = null;
      const state = dragRef.current;
      dragRef.current = null;
      if (state?.active === true) {
        suppressClickRef.current = true;
        window.setTimeout(() => {
          suppressClickRef.current = false;
        }, 0);
      }
      setDraggingKey(null);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      window.cancelAnimationFrame(frame);
    };
  }, []);

  const beginDrag = (tab: TabItem, event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }
    const target = event.target as HTMLElement;
    if (target.closest(".tab__close") !== null) {
      return;
    }
    dragRef.current = {
      key: tab.key,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
    };
  };

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
              ref={(element) => {
                if (element === null) {
                  tabRefs.current.delete(tab.key);
                } else {
                  tabRefs.current.set(tab.key, element);
                }
              }}
              data-tab-key={tab.key}
              role="tab"
              aria-selected={tab.key === activeKey}
              className={`tab${tab.key === activeKey ? " tab--active" : ""}${draggingKey === tab.key ? " tab--dragging" : ""}`}
              onPointerDown={(event) => beginDrag(tab, event)}
              onClick={() => {
                if (suppressClickRef.current) {
                  return;
                }
                onActivate(tab.key);
              }}
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
          aria-label="广播输入"
        >
          <BroadcastIcon />
        </button>
      )}
      {showForward && (
        <button
          type="button"
          className={`tab-bar__action${forwardOpen ? " tab-bar__action--active" : ""}`}
          onClick={onToggleForward}
          disabled={activeKey === null}
          title="端口转发（-L / -R / -D）"
          aria-label="端口转发"
        >
          <ForwardIcon />
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
