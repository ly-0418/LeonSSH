import { useEffect, useLayoutEffect, useRef, useState } from "react";

import type { TerminalStatus } from "../lib/ipc/types";
import { LINUX_COMMANDS, canonicalCommand, describeCommand } from "../lib/terminal/commands";
import { snippetInsertion, snippetTemplate } from "../lib/terminal/snippet";
import { setSuggestionKeyHandler } from "../lib/terminal/TerminalSession";
import { bumpCommandUsage, bumpSnippet, loadCommandUsage, loadSnippets } from "../lib/ipc/usage";
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
  const [snippets, setSnippets] = useState<Record<string, number>>({});
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
      const raw = value.trim();
      if (raw.length === 0) {
        return;
      }
      const first = raw.split(/\s+/)[0] ?? "";
      const canonical = canonicalCommand(first);
      if (canonical !== null) {
        void bumpCommandUsage(canonical).then(() =>
          setUsage((current) => ({ ...current, [canonical]: (current[canonical] ?? 0) + 1 })),
        );
      }
      if (raw.includes(" ") || raw.includes("|")) {
        const template = snippetTemplate(raw);
        if (template !== null) {
          void bumpSnippet(template).then(() =>
            setSnippets((current) => ({ ...current, [template]: (current[template] ?? 0) + 1 })),
          );
        }
      }
    },
  });

  const typed = line.trimStart();
  const isCompound = typed.includes(" ") || typed.includes("|");
  const commandMatches =
    !suggestDismissed && typed.length > 0 && !isCompound
      ? LINUX_COMMANDS.filter(
          (command) =>
            (command.name.startsWith(typed) ||
              (command.aliases ?? []).some(
                (alias) => alias.startsWith(typed) && alias !== typed,
              )),
        )
          .sort((a, b) => (usage[b.name] ?? 0) - (usage[a.name] ?? 0) || a.name.localeCompare(b.name))
          .slice(0, 8)
      : [];
  const snippetMatches =
    !suggestDismissed && isCompound
      ? Object.entries(snippets)
          .filter(([item]) => item.startsWith(typed) && item !== typed)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8)
      : [];
  const rows: Array<{ name: string; desc: string; insert?: string }> = isCompound
    ? snippetMatches.map(([item]) => ({ name: item, desc: "常用命令组合", insert: snippetInsertion(item) }))
    : commandMatches.map((item) => ({ name: item.name, desc: describeCommand(item) }));
  const activeCount = rows.length;

  function bumpUsageLocal(name: string): void {
    void bumpCommandUsage(name).then(() =>
      setUsage((current) => ({ ...current, [name]: (current[name] ?? 0) + 1 })),
    );
  }

  function acceptSuggestion(index: number, execute = false): void {
    const pick = rows[index];
    if (pick !== undefined) {
      const canonical = canonicalCommand(pick.name.split(/\s+/)[0] ?? pick.name);
      if (canonical !== null) {
        bumpUsageLocal(canonical);
      }
      if (typed.length > 0) {
        backspace(typed.length);
      }
      insertText(pick.insert ?? pick.name);
        if (execute) {
          window.setTimeout(() => insertText("\r"), 40);
        }
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
    setSuggestionKeyHandler((event) => {
      if (dismissedRef.current) {
        return false;
      }
      if (HANDLED_KEYS.has(event.key)) {
        event.preventDefault();
        event.stopPropagation();
      }
      if (event.key === "Tab" || event.key === "Enter") {
        const index = Math.min(suggestIndex, activeCount - 1);
        const pending = (rows[index]?.name ?? "").trim();
        if (pending === typed) {
          dismissedRef.current = true;
          setSuggestionKeyHandler(null);
          setSuggestDismissed(true);
          return event.key === "Tab";
        }
        acceptSuggestion(index, event.key === "Enter");
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

  // Right-click / stray clicks can steal keyboard focus from xterm; give it back
  // unless a dialog is open or the user is typing in another field.
  useEffect(() => {
    if (!visible) {
      return;
    }
    const refocusAfterPointer = () => {
      if (document.querySelector(".modal-backdrop, .drawer-layer") !== null) {
        return;
      }
      const active = document.activeElement as HTMLElement | null;
      const tag = active?.tagName ?? "";
      if ((tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") && !active?.classList.contains("xterm-helper-textarea")) {
        return;
      }
      focus();
    };
    window.addEventListener("pointerup", refocusAfterPointer, true);
    window.addEventListener("contextmenu", refocusAfterPointer, true);
    return () => {
      window.removeEventListener("pointerup", refocusAfterPointer, true);
      window.removeEventListener("contextmenu", refocusAfterPointer, true);
    };
  }, [visible, focus]);

    return () => setSuggestionKeyHandler(null);
  }, [visible, activeCount, suggestIndex, rows]);
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
    const header = 34;
    const itemTop = active.offsetTop;
    const itemBottom = itemTop + active.offsetHeight;
    if (itemTop - header < list.scrollTop) {
      list.scrollTop = Math.max(0, itemTop - header);
    } else if (itemBottom > list.scrollTop + list.clientHeight) {
      list.scrollTop = itemBottom - list.clientHeight;
    }
  }, [suggestIndex, activeCount]);
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
  }, [activeCount, line, containerRef]);

  // Usage counters come from SQLite: they persist across restarts and upgrades.
  useEffect(() => {
    let cancelled = false;
    void loadSnippets().then((counts) => {
      if (!cancelled) {
        setSnippets(counts);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);
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
    void loadSnippets().then((counts) => {
      if (!cancelled) {
        setSnippets(counts);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);
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
    void loadSnippets().then((counts) => {
      if (!cancelled) {
        setSnippets(counts);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);
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
    <section
        className="terminal-pane"
        data-visible={visible}
        ref={paneRef}
        onPointerDown={() => focus()}
        onContextMenu={(event) => {
          event.preventDefault();
          focus();
        }}
      >

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
            <span className="terminal-suggest__keys">Tab 填入 · Enter 填入并执行 · ↑↓ 选择 · Esc 关闭</span>
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
              <span className={`terminal-suggest__name`}>{command.name}</span>
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
