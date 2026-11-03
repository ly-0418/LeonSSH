import { useEffect, useState } from "react";

import type { TerminalStatus } from "../lib/ipc/types";
import { useTerminal } from "../hooks/useTerminal";
import type { ThemeMode } from "../lib/terminal/theme";

interface TerminalTabProps {
  sessionId: number;
  title: string;
  visible: boolean;
  theme: ThemeMode;
  fontSize: number;
  state: TerminalStatus["state"];
  onStatus: (patch: Partial<TerminalStatus>) => void;
  onReconnect?: () => void;
}

/**
 * One xterm instance per open tab. The component stays mounted while the tab
 * exists (hidden tabs only stop rendering), so switching tabs keeps scrollback.
 */
export function TerminalTab({
  sessionId,
  title,
  visible,
  theme,
  fontSize,
  state,
  onStatus,
  onReconnect,
}: TerminalTabProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { containerRef, notice, clearNotice, findNext, findPrevious } = useTerminal({
    sessionId,
    title,
    visible,
    theme,
    fontSize,
    onStatus,
  });

  useEffect(() => {
    if (!visible) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setSearchOpen(true);
      } else if (event.key === "Escape") {
        setSearchOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible]);

  return (
    <section className="terminal-pane">

      {searchOpen && (
        <div className="terminal-search">
          <input
            autoFocus
            className="terminal-search__input"
            value={query}
            placeholder="搜索终端输出…（回车查找，Shift+回车向上）"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                if (event.shiftKey) {
                  findPrevious(query);
                } else {
                  findNext(query);
                }
              }
            }}
          />
          <button type="button" className="terminal-search__btn" onClick={() => findPrevious(query)} title="上一个">↑</button>
          <button type="button" className="terminal-search__btn" onClick={() => findNext(query)} title="下一个">↓</button>
          <button type="button" className="terminal-search__btn" onClick={() => setSearchOpen(false)} title="关闭">✕</button>
        </div>
      )}

      <div className="terminal-host" ref={containerRef} />

      {state === "closed" && onReconnect !== undefined && (
        <button type="button" className="terminal-reconnect" onClick={onReconnect}>
          连接已断开，点击重新连接
        </button>
      )}

      {notice !== null && (
        <button type="button" className="terminal-notice" onClick={clearNotice}>
          <span className="terminal-notice__dot" />
          {notice}
          <span className="terminal-notice__dismiss">点击关闭</span>
        </button>
      )}
    </section>
  );
}
