import { useEffect, useState } from "react";

import type { TerminalStatus } from "../lib/ipc/types";
import { LINUX_COMMANDS } from "../lib/terminal/commands";
import { bumpUsage, usageOf } from "../lib/terminal/usage";
import { useTerminal } from "../hooks/useTerminal";
import type { ThemeMode } from "../lib/terminal/theme";

interface TerminalTabProps {
  sessionId: number;
  title: string;
  visible: boolean;
  theme: ThemeMode;
  fontSize: number;
  state: TerminalStatus["state"];
  /** Bumped by the tab menu to re-open the session in place. */
  reconnectAt?: number;
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
  reconnectAt,
  onStatus,
  onReconnect,
}: TerminalTabProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [line, setLine] = useState("");
  const [suggestIndex, setSuggestIndex] = useState(0);
  const [suggestDismissed, setSuggestDismissed] = useState(false);
  const [panelStyle, setPanelStyle] = useState<{ left: number; top: number } | null>(null);
  const { containerRef, notice, clearNotice, reconnect, insertText, cursorBox, findNext, findPrevious } = useTerminal({
    sessionId,
    title,
    visible,
    theme,
    fontSize,
    onStatus,
    onInputLine: (value) => {
      setLine(value);
      setSuggestDismissed(false);
      setSuggestIndex(0);
    },
  });

  const typed = line.trimStart();
  const candidates =
    !suggestDismissed && typed.length > 0 && !typed.includes(" ")
      ? LINUX_COMMANDS.filter(
          (command) => command.name.startsWith(typed) && command.name !== typed,
        )
          .sort((a, b) => usageOf(b.name) - usageOf(a.name) || a.name.localeCompare(b.name))
          .slice(0, 8)
      : [];

  // Anchor the popup to the caret: below it when there is room, above otherwise.
  useEffect(() => {
    if (candidates.length === 0) {
      setPanelStyle(null);
      return;
    }
    const box = cursorBox();
    if (box === null) {
      return;
    }
    const panelHeight = 46 + candidates.length * 26;
    const below = box.top + box.cellHeight + panelHeight < box.height;
    setPanelStyle({
      left: Math.max(4, Math.min(box.left, box.width - 340)),
      top: below ? box.top + box.cellHeight + 2 : Math.max(4, box.top - panelHeight - 2),
    });
  }, [candidates, cursorBox]);

  useEffect(() => {
    if (!visible || candidates.length === 0) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Tab" || event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        const pick = candidates[Math.min(suggestIndex, candidates.length - 1)];
        if (pick !== undefined) {
          bumpUsage(pick.name);
          insertText(pick.name.slice(typed.length));
        }
        setSuggestDismissed(true);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        event.stopPropagation();
        setSuggestIndex((current) => (current + 1) % candidates.length);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        setSuggestIndex((current) => (current - 1 + candidates.length) % candidates.length);
      } else if (event.key === "Escape") {
        event.preventDefault();
        setSuggestDismissed(true);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [visible, candidates, suggestIndex, insertText, typed]);

  useEffect(() => {
    if (reconnectAt !== undefined && reconnectAt > 0) {
      reconnect();
    }
    // Reconnect only when the tick changes, never on first render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reconnectAt]);


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
    <section className="terminal-pane" data-visible={visible}>

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

      {candidates.length > 0 && (
        <div className="terminal-suggest" style={panelStyle ?? undefined}>
          <div className="terminal-suggest__head">
            <span className="terminal-suggest__pick">
              {candidates[Math.min(suggestIndex, candidates.length - 1)].name}
            </span>
            <span className="terminal-suggest__keys">Tab 填入 · ↑↓ 选择 · Enter 确认 · Esc 关闭</span>
          </div>
          {candidates.map((command, index) => (
            <button
              type="button"
              key={command.name}
              className={`terminal-suggest__item${
                index === suggestIndex ? " terminal-suggest__item--active" : ""
              }`}
              onMouseDown={(event) => {
                event.preventDefault();
                bumpUsage(command.name);
                insertText(command.name.slice(typed.length));
                setSuggestDismissed(true);
              }}
            >
              <span className="terminal-suggest__name">{command.name}</span>
              <span className="terminal-suggest__desc">{command.desc}</span>
            </button>
          ))}
        </div>
      )}

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
