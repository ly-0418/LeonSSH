import { useEffect, useLayoutEffect, useRef, useState } from "react";

import type { TerminalStatus } from "../lib/ipc/types";
import { LINUX_COMMANDS } from "../lib/terminal/commands";
import { setSuggestionKeyHandler } from "../lib/terminal/TerminalSession";
import { bumpCommandUsage, loadCommandUsage } from "../lib/ipc/usage";
import { listRemoteNames } from "../lib/ipc/sftp";
import { useTerminal } from "../hooks/useTerminal";
import type { ThemeMode } from "../lib/terminal/theme";

const HANDLED_KEYS = new Set(["Tab", "Enter", "ArrowUp", "ArrowDown", "Escape"]);

interface TerminalTabProps {
  sessionId: number;
  /** Active SSH terminal id (needed for path completion). */
  terminalId?: string;
  title: string;
  visible: boolean;
  theme: ThemeMode;
  fontSize: number;
  cursorStyle: "bar" | "underline";
  cursorWidth: number;
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
  terminalId,
  visible,
  theme,
  fontSize,
  cursorStyle,
  cursorWidth,
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
  const [usage, setUsage] = useState<Record<string, number>>({});
  const [pathItems, setPathItems] = useState<Array<{ name: string; isDir: boolean }>>([]);
  const [pathDir, setPathDir] = useState<string | null>(null);
  const suggestListRef = useRef<HTMLDivElement | null>(null);
  const paneRef = useRef<HTMLElement | null>(null);
  /** Keeps the popup closed after accepting a file (no deeper level). */
  const ignoreNextLineRef = useRef(false);
  const previousLineRef = useRef("");
  /** Synchronous mirror of suggestDismissed so the key handler never acts on a closed popup. */
  const dismissedRef = useRef(false);
  const { containerRef, notice, clearNotice, reconnect, insertText, backspace, findNext, findPrevious, focus } = useTerminal({
    sessionId,
    title,
    visible,
    theme,
    fontSize,
  cursorStyle,
  cursorWidth,
    onStatus,
    onInputLine: (value) => {
      setLine(value);
      const deleting = value.length < previousLineRef.current.length;
      previousLineRef.current = value;
      if (deleting) {
        setSuggestDismissed(true);
        return;
      }
      if (ignoreNextLineRef.current) {
        ignoreNextLineRef.current = false;
        setSuggestDismissed(true);
        focus();
        return;
      }
      setSuggestDismissed(false);
      setSuggestIndex(0);
    },
    onExecuted: (value) => {
      const name = value.trim().split(/\s+/)[0] ?? "";
      if (LINUX_COMMANDS.some((command) => command.name === name)) {
        void bumpCommandUsage(name).then(() =>
          setUsage((current) => ({ ...current, [name]: (current[name] ?? 0) + 1 })),
        );
      }
    },
  });

  const typed = line.trimStart();
  const candidates =
    !suggestDismissed && typed.length > 0 && !typed.includes(" ")
      ? LINUX_COMMANDS.filter(
          (command) => command.name.startsWith(typed) && command.name !== typed,
        )
          .sort((a, b) => (usage[b.name] ?? 0) - (usage[a.name] ?? 0) || a.name.localeCompare(b.name))
          .slice(0, 8)
      : [];


  // Path mode: completing the last token when it contains a slash.
  const lastToken = typed.split(" ").pop() ?? "";
  const isPathMode = lastToken.includes("/") && (typed.includes(" ") || lastToken.startsWith("/") || lastToken.startsWith("./"));
  const slashIndex = lastToken.lastIndexOf("/");
  const dirPart = isPathMode ? lastToken.slice(0, slashIndex + 1) : "";
  const prefixPart = isPathMode ? lastToken.slice(slashIndex + 1) : "";

  useEffect(() => {
    if (!isPathMode || terminalId === undefined) {
      setPathItems([]);
      setPathDir(null);
      return;
    }
    const dir = dirPart.length === 0 ? "/" : dirPart;
    if (pathDir === dir && pathItems.length > 0) {
      return;
    }
    const timer = window.setTimeout(() => {
      void listRemoteNames(terminalId, dir, 400)
        .then((items) => {
          setPathItems(items.map((item) => ({ name: item.name, isDir: item.isDir })));
          setPathDir(dir);
        })
        .catch(() => {
          setPathItems([]);
          setPathDir(dir);
        });
    }, 160);
    return () => window.clearTimeout(timer);
  }, [isPathMode, terminalId, dirPart, pathDir]);

  const pathSuggestions = isPathMode
    ? pathItems
        .filter((entry) => entry.name.startsWith(prefixPart))
        .filter((entry) => !entry.name.startsWith(".") || prefixPart.startsWith("."))
        .filter((entry) => entry.name !== prefixPart)
        .sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name))
        .slice(0, 8)
    : [];

  const rows = isPathMode
    ? pathSuggestions.map((item) => ({ name: item.name, desc: item.isDir ? "目录" : "文件", isDir: item.isDir }))
    : candidates.map((item) => ({ name: item.name, desc: item.desc, isDir: false }));
  const activeCount = rows.length;

  function bumpUsageLocal(name: string): void {
    void bumpCommandUsage(name).then(() =>
      setUsage((current) => ({ ...current, [name]: (current[name] ?? 0) + 1 })),
    );
  }

  function acceptSuggestion(index: number): void {
    void import("@tauri-apps/api/core").then(({ invoke }) =>
      invoke("frontend_error", {
        message: `accept idx=${index} path=${String(isPathMode)} cand=${pathSuggestions.length} rows=${rows.length} prefix=${JSON.stringify(prefixPart)} typed=${JSON.stringify(typed)}`,
      }),
    );
    if (isPathMode) {
      const pick = pathSuggestions[index];
      if (pick !== undefined) {
        if (prefixPart.length > 0) {
          backspace(prefixPart.length);
        }
        if (true) {
          ignoreNextLineRef.current = true;
        }
        insertText(pick.name);
        dismissedRef.current = true;
        setSuggestionKeyHandler(null);
        setSuggestDismissed(true);
        focus();
      }
      return;
    }
    const pick = candidates[index];
    if (pick !== undefined) {
      bumpUsageLocal(pick.name);
      insertText(pick.name.slice(typed.length));
    }
    setSuggestDismissed(true);
  }


  // xterm's custom handler runs before its own key processing: this is the
  // reliable place to intercept Tab/Enter/Arrows while the popup is open.
  useEffect(() => {
    if (!visible || activeCount === 0) {
      setSuggestionKeyHandler(null);
      return;
    }
    void import("@tauri-apps/api/core").then(({ invoke }) =>
      invoke("frontend_error", { message: `suggest-register active=${activeCount} path=${String(isPathMode)}` }),
    );
    setSuggestionKeyHandler((event) => {
      if (dismissedRef.current) {
        return false;
      }
      if (HANDLED_KEYS.has(event.key)) {
        event.preventDefault();
        event.stopPropagation();
      }
      if (event.key === "Tab" || event.key === "Enter") {
        acceptSuggestion(Math.min(suggestIndex, activeCount - 1));
        return true;
      }
      if (event.key === "ArrowDown") {
        setSuggestIndex((current) => (current + 1) % activeCount);
        return true;
      }
      if (event.key === "ArrowUp") {
        setSuggestIndex((current) => (current - 1 + activeCount) % activeCount);
        return true;
      }
      if (event.key === "Escape") {
        dismissedRef.current = true;
        setSuggestDismissed(true);
        focus();
        return true;
      }
      return false;
    });
    return () => setSuggestionKeyHandler(null);
  }, [visible, activeCount, suggestIndex, isPathMode, rows]);
  // Keep the highlighted candidate visible inside the scrollable popup.
  useEffect(() => {
    const list = suggestListRef.current;
    if (list === null) {
      return;
    }
    const items = list.querySelectorAll<HTMLElement>(".terminal-suggest__item");
    const active = items[Math.min(suggestIndex, items.length - 1)];
    if (active === undefined) {
      return;
    }
    // Wrapping to the first item must clear the sticky header, otherwise the
    // highlighted row hides underneath it.
    if (suggestIndex === 0) {
      list.scrollTop = 0;
    }
    active.scrollIntoView({ block: "nearest" });
  }, [suggestIndex, activeCount, isPathMode]);
  // Anchor the popup to the real caret: the hidden textarea sits exactly on the
  // cursor cell, so its rect is a reliable anchor inside the pane.
  useLayoutEffect(() => {
    if (rows.length === 0) {
      return;
    }
    const pane = paneRef.current;
    const textarea = containerRef.current?.querySelector<HTMLElement>(".xterm-helper-textarea");
    if (pane === null || textarea === null || textarea === undefined) {
      return;
    }
    const paneRect = pane.getBoundingClientRect();
    const caretRect = textarea.getBoundingClientRect();
    const panelHeight = 46 + Math.min(rows.length, 5) * 26;
    const below = caretRect.bottom - paneRect.top + 4;
    const above = caretRect.top - paneRect.top - panelHeight - 4;
    const next = {
      left: Math.max(8, Math.min(caretRect.left - paneRect.left, paneRect.width - 360)),
      top: below + panelHeight < paneRect.height ? below : Math.max(4, above),
    };
    // Only update when the position really moved; otherwise React would loop
    // (effect → state → render → effect).
    setPanelStyle((current) =>
      current !== null &&
      Math.abs(current.left - next.left) < 1 &&
      Math.abs(current.top - next.top) < 1
        ? current
        : next,
    );
  }, [rows, containerRef]);

  // Usage counters come from SQLite: they persist across restarts and upgrades.
  useEffect(() => {
    let cancelled = false;
    void loadCommandUsage().then((counts) => {
      if (!cancelled) {
        setUsage(counts);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);


  // Usage counters come from SQLite: they persist across restarts and upgrades.
  useEffect(() => {
    let cancelled = false;
    void loadCommandUsage().then((counts) => {
      if (!cancelled) {
        setUsage(counts);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (reconnectAt !== undefined && reconnectAt > 0) {
      reconnect();
    }
    // Reconnect only when the tick changes, never on first render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reconnectAt]);


  // Usage counters come from SQLite: they persist across restarts and upgrades.
  useEffect(() => {
    let cancelled = false;
    void loadCommandUsage().then((counts) => {
      if (!cancelled) {
        setUsage(counts);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

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
    <section className="terminal-pane" data-visible={visible} ref={paneRef}>

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

      {activeCount > 0 && (
        <div className="terminal-suggest" ref={suggestListRef} style={panelStyle ?? undefined}>
          <div className="terminal-suggest__head">
            <span className="terminal-suggest__pick">
              {rows[Math.min(suggestIndex, activeCount - 1)]?.name}
            </span>
            <span className="terminal-suggest__keys">Tab 填入 · ↑↓ 选择 · Enter 确认 · Esc 关闭</span>
          </div>
          {rows.map((command, index) => (
            <button
              type="button"
              key={command.name}
              className={`terminal-suggest__item${
                index === suggestIndex ? " terminal-suggest__item--active" : ""
              }`}
              onMouseDown={(event) => {
                event.preventDefault();
                void bumpCommandUsage(command.name).then(() => setUsage((current) => ({ ...current, [command.name]: (current[command.name] ?? 0) + 1 })));
                insertText(command.name.slice(typed.length));
                setSuggestDismissed(true);
        focus();
              }}
            >
              <span className={`terminal-suggest__name${command.isDir ? " terminal-suggest__name--dir" : ""}`}>{command.name}</span>
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
