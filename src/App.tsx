import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { FileManager } from "./components/file-manager/FileManager";
import { ForwardPanel } from "./components/ForwardPanel";
import { NewSessionDialog } from "./components/NewSessionDialog";
import { SessionForm } from "./components/SessionForm";
import { SettingsDrawer } from "./components/SettingsDrawer";
import { StatusBar } from "./components/StatusBar";
import { TabBar, type TabItem } from "./components/TabBar";
import { TerminalTab } from "./components/TerminalTab";
import { WindowControls } from "./components/WindowControls";
import { ConfirmDialog } from "./components/dialogs";
import { setBroadcastHandler } from "./lib/terminal/TerminalSession";
import { listen } from "@tauri-apps/api/event";
import { startAllForwards } from "./lib/ipc/forwards";
import { toUserMessage } from "./lib/ipc/errors";
import { closeTerminal, writeTerminal } from "./lib/ipc/session";
import { deleteSession, listSessions } from "./lib/ipc/sessions";
import type { SessionSummary, TerminalStatus } from "./lib/ipc/types";
import type { ThemeMode } from "./lib/terminal/theme";

const INITIAL_STATUS: TerminalStatus = {
  terminalId: null,
  renderer: "pending",
  cols: 0,
  rows: 0,
  state: "connecting",
};

type WorkspaceView = "terminal" | "files";

interface SessionDialogState {
  creating: boolean;
  selectedId: number | null;
}

const THEME_KEY = "leonssh.theme";

function initialTheme(): ThemeMode {
  return localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark";
}

export default function App() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [tabs, setTabs] = useState<TabItem[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [mode, setMode] = useState<"terminal" | "form">("terminal");
  const [editing, setEditing] = useState<SessionSummary | null>(null);
  const [view, setView] = useState<WorkspaceView>(() =>
    new URLSearchParams(window.location.search).get("view") === "files" ? "files" : "terminal",
  );
  const [filesExiting, setFilesExiting] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** Tabs whose saved forward rules were already auto-started. */
  const startedForwards = useRef<Set<string>>(new Set());
  const [forwardOpen, setForwardOpen] = useState(false);
  const [fontFamily, setFontFamily] = useState<string>(
    () => localStorage.getItem("leonssh.fontFamily") ?? "Cascadia Mono, Consolas, monospace",
  );
  const [cursorStyle, setCursorStyle] = useState<"bar" | "underline">(
    () => (localStorage.getItem("leonssh.cursorStyle") === "underline" ? "underline" : "bar"),
  );
  const [cursorWidth, setCursorWidth] = useState<number>(() => {
    const stored = Number.parseInt(localStorage.getItem("leonssh.cursorWidth") ?? "", 10);
    return Number.isFinite(stored) && stored >= 1 && stored <= 6 ? stored : 2;
  });
  /** Incremented per tab to re-open its SSH session without remounting xterm. */
  const [reconnectTicks, setReconnectTicks] = useState<Record<string, number>>({});
  const [broadcast, setBroadcast] = useState<boolean>(
    () => localStorage.getItem("leonssh.broadcast") === "1",
  );
  const [forwardClosing, setForwardClosing] = useState(false);
  const [settingsClosing, setSettingsClosing] = useState(false);
  const [fontSize, setFontSize] = useState<number>(() => {
    const stored = Number.parseInt(localStorage.getItem("leonssh.fontSize") ?? "", 10);
    return Number.isFinite(stored) && stored >= 11 && stored <= 20 ? stored : 16;
  });

  useEffect(() => {
    localStorage.setItem("leonssh.fontSize", String(fontSize));
  }, [fontSize]);
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState<ThemeMode>(initialTheme);
  const [sessionDialog, setSessionDialog] = useState<SessionDialogState | null>(null);

  const [pendingDelete, setPendingDelete] = useState<SessionSummary | null>(null);
  // Dialogs and drawers steal focus; hand it back to the active terminal.
  useEffect(() => {
    if (settingsOpen || sessionDialog !== null || pendingDelete !== null || view !== "terminal") {
      return;
    }
    const target = document.querySelector<HTMLElement>(
      '.terminal-pane[data-visible="true"] .xterm-helper-textarea',
    );
    target?.focus();
  }, [settingsOpen, sessionDialog, pendingDelete, view]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  const refreshSessions = useCallback(async (): Promise<SessionSummary[]> => {
    try {
      const list = await listSessions();
      setSessions(list);
      if (list.length === 0) {
        setMode("form");
      }
      return list;
    } catch (err) {
      setError(toUserMessage(err));
      return [];
    }
  }, []);

  useEffect(() => {
    void refreshSessions();
  }, [refreshSessions]);

  // The WebView's built-in context menu (reload / inspect / print ...) is not
  // wanted; the tab bar draws its own menu instead.
  useEffect(() => {
    const block = (event: MouseEvent) => event.preventDefault();
    document.addEventListener("contextmenu", block);
    return () => document.removeEventListener("contextmenu", block);
  }, []);

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.key === activeKey) ?? null,
    [tabs, activeKey],
  );

  const openTab = useCallback(
    (session: SessionSummary, force = false) => {
      const existing = force ? undefined : tabs.find((tab) => tab.sessionId === session.id);
      if (existing) {
        setActiveKey(existing.key);
        setMode("terminal");
        return;
      }
      const key = `tab-${session.id}-${Date.now()}`;
      setTabs((prev) => [
        ...prev,
        { key, sessionId: session.id, title: session.name, status: { ...INITIAL_STATUS } },
      ]);
      setActiveKey(key);
      setMode("terminal");
    },
    [tabs],
  );

  // Deep link: `?connect=<session id>` opens (and therefore connects) a session
  // on startup. Used by scripts/smoke tests; harmless in normal launches.
  const autoConnectId = useMemo(() => {
    const raw = new URLSearchParams(window.location.search).get("connect");
    const parsed = raw === null ? Number.NaN : Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }, []);
  const autoConnectedRef = useRef(false);

  useEffect(() => {
    if (autoConnectedRef.current || autoConnectId === null) {
      return;
    }
    const session = sessions.find((item) => item.id === autoConnectId);
    if (session === undefined) {
      return;
    }
    autoConnectedRef.current = true;
    openTab(session);
  }, [autoConnectId, sessions, openTab]);

  // Duplicate a tab: same saved session, brand new SSH connection, title gets
  // a ` | 复制 N` suffix (N increments per source session).
  const duplicateTab = useCallback(
    (key: string) => {
      const source = tabs.find((tab) => tab.key === key);
      if (source === undefined) {
        return;
      }
      const base = source.title.replace(/ \| 复制 \d+$/, "");
      const prefix = `${base} | 复制 `;
      const copies = tabs.filter((tab) => tab.title.startsWith(prefix)).length;
      const newKey = `tab-${source.sessionId}-${Date.now()}`;
      setTabs((prev) => [
        ...prev,
        {
          key: newKey,
          sessionId: source.sessionId,
          title: `${prefix}${copies + 1}`,
          status: { ...INITIAL_STATUS },
        },
      ]);
      setActiveKey(newKey);
    },
    [tabs],
  );

  const closeTab = useCallback(
    (key: string) => {
      const next = tabs.filter((tab) => tab.key !== key);
      setTabs(next);
      if (activeKey === key) {
        setActiveKey(next.length > 0 ? next[next.length - 1].key : null);
      }
      if (next.length === 0) {
        setView("terminal");
        if (sessions.length === 0) {
          setMode("form");
        }
      }
    },
    [tabs, activeKey, sessions.length],
  );

  const makeStatusHandler = useCallback(
    (key: string) => (patch: Partial<TerminalStatus>) => {
      setTabs((prev) => {
        const next = prev.map((tab) =>
          tab.key === key ? { ...tab, status: { ...tab.status, ...patch } } : tab,
        );
        if (patch.state === "ready") {
          const tab = next.find((item) => item.key === key);
          if (tab !== undefined && tab.status.terminalId !== null && !startedForwards.current.has(key)) {
            startedForwards.current.add(key);
            void startAllForwards(tab.status.terminalId, tab.sessionId).catch(() => undefined);
          }
        }
        return next;
      });
    },
    [],
  );

  async function handleSaved(session: SessionSummary) {
    setEditing(null);
    setError(null);
    setSessionDialog(null);
    const list = await refreshSessions();
    const saved = list.find((item) => item.id === session.id) ?? session;
    openTab(saved);
  }

  async function handleDelete(session: SessionSummary) {
    setPendingDelete(null);
    try {
      await deleteSession(session.id);
      const tab = tabs.find((item) => item.sessionId === session.id);
      if (tab) {
        closeTab(tab.key);
      }
      const list = await refreshSessions();
      if (list.length === 0) {
        setMode("form");
      }
      // Keep the connection dialog open and select the next session.
      setSessionDialog((current) =>
        current === null
          ? null
          : { creating: list.length === 0, selectedId: list[0]?.id ?? null },
      );
    } catch (err) {
      setError(toUserMessage(err));
    }
  }

  /** Slide the file manager out (it stays mounted until the animation ends). */
  const closeFiles = useCallback(() => {
    setFilesExiting(true);
    setView("terminal");
    window.setTimeout(() => setFilesExiting(false), 220);
  }, []);

  /** Slides the settings drawer out before unmounting it. */
  const closeSettings = useCallback(() => {
    setSettingsClosing(true);
    window.setTimeout(() => {
      setSettingsOpen(false);
      setSettingsClosing(false);
    }, 200);
  }, []);

  /** Slides the forward sheet out to the right. */
  const toggleForward = useCallback(() => {
    if (forwardOpen) {
      setForwardClosing(true);
      window.setTimeout(() => {
        setForwardOpen(false);
        setForwardClosing(false);
      }, 200);
    } else {
      setForwardClosing(false);
      setForwardOpen(true);
    }
  }, [forwardOpen]);

  /** Re-opens a dropped tab with the same saved profile. */
  /** Re-opens the session inside the existing tab (scrollback is preserved). */
  const reconnectTab = useCallback((tab: TabItem) => {
    setReconnectTicks((prev) => ({ ...prev, [tab.key]: (prev[tab.key] ?? 0) + 1 }));
  }, []);

  /** Closes the SSH channel of one tab and leaves the tab in the "closed" state. */
  const disconnectTab = useCallback(
    (key: string) => {
      const tab = tabs.find((item) => item.key === key);
      if (tab === undefined || tab.status.terminalId === null) {
        return;
      }
      const terminalId = tab.status.terminalId;
      setTabs((prev) =>
        prev.map((item) =>
          item.key === key
            ? { ...item, status: { ...item.status, terminalId: null, state: "closed" } }
            : item,
        ),
      );
      void closeTerminal(terminalId).catch(() => undefined);
    },
    [tabs],
  );

  const openFiles = useCallback(() => {
    setFilesExiting(false);
    setView("files");
  }, []);

  /** Close the file manager and cd into the selected remote folder. */
  const openInTerminal = useCallback(
    (remotePath: string) => {
      const terminalId = activeTab?.status.terminalId ?? null;
      closeFiles();
      if (terminalId === null) {
        return;
      }
      const escaped = remotePath.replace(/'/g, "'\\''");
      void writeTerminal(terminalId, new TextEncoder().encode(`cd -- '${escaped}'\n`)).catch(
        (err) => setError(toUserMessage(err)),
      );
    },
    [activeTab, closeFiles],
  );
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<string>("terminal-closed", (event) => {
      const terminalId = event.payload;
      setTabs((prev) =>
        prev.map((tab) =>
          tab.status.terminalId === terminalId
            ? { ...tab, status: { ...tab.status, terminalId: null, state: "closed" } }
            : tab,
        ),
      );
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, []);

  useEffect(() => {
    if (!broadcast) {
      setBroadcastHandler(null);
      return;
    }
    setBroadcastHandler((data) => {
      const bytes = new TextEncoder().encode(data);
      for (const tab of tabs) {
        if (tab.key !== activeKey && tab.status.terminalId !== null) {
          void writeTerminal(tab.status.terminalId, bytes);
        }
      }
    });
    return () => setBroadcastHandler(null);
  }, [broadcast, tabs, activeKey]);

  return (
    <div className="app">
      <header className="app-header" data-tauri-drag-region>
        <div className="brand">
          <span className="brand__mark">▌</span>
          <h1 className="brand__title">LeonSSH</h1>
          <span className="brand__subtitle">多标签 · SQLite 会话 · 凭据管理器</span>
        </div>
        <div className="app-header__actions">
          <button
            type="button"
            className={`header-action header-action--icon${view === "files" ? " header-action--active" : ""}`}
            title="文件传输"
            aria-label="文件传输"
            onClick={() => (view === "files" ? closeFiles() : openFiles())}
          >
            <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 8h13" />
              <path d="m14 4.5 3.5 3.5L14 11.5" />
              <path d="M20 16H7" />
              <path d="M10 12.5 6.5 16l3.5 3.5" />
            </svg>
          </button>
          <button
            type="button"
            className={`header-action header-action--icon${settingsOpen ? " header-action--active" : ""}`}
            title="设置"
            aria-label="设置"
            onClick={() => setSettingsOpen((open) => !open)}
          >
            <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="3.2" />
              <path d="M19.4 14.8a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21a2 2 0 1 1-4 0v-.2a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H3a2 2 0 1 1 0-4h.2a1.7 1.7 0 0 0 1.6-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.6V3a2 2 0 1 1 4 0v.2a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.6 1H21a2 2 0 1 1 0 4h-.2a1.7 1.7 0 0 0-1.4 1z" />
            </svg>
          </button>
          <WindowControls />
        </div>
      </header>

      {error !== null && (
        <div className="boot-error" onClick={() => setError(null)} role="presentation">
          {error}（点击关闭）
        </div>
      )}

      <div className="app-body">
        <main className="workspace">
          <TabBar
            tabs={tabs}
            activeKey={activeKey}
            onActivate={setActiveKey}
            onClose={closeTab}
            onNewSession={() =>
              setSessionDialog({
      creating: true,
                selectedId: sessions[0]?.id ?? null,
              })
            }
            onDuplicate={duplicateTab}
            forwardOpen={forwardOpen}
            onToggleForward={toggleForward}
            broadcast={broadcast}
            onReconnect={(key) => {
              const tab = tabs.find((item) => item.key === key);
              if (tab !== undefined) {
                reconnectTab(tab);
              }
            }}
            onDisconnect={disconnectTab}
            onToggleBroadcast={() => {
              setBroadcast((current) => {
                localStorage.setItem("leonssh.broadcast", current ? "0" : "1");
                return !current;
              });
            }}

          />

          {mode === "form" && sessions.length === 0 && (
            <div className="workspace__form">
              <SessionForm
                initial={editing}
                onboarding={sessions.length === 0}
                onSaved={(session) => void handleSaved(session)}
                onSavedAndConnect={(session) => void handleSaved(session)}
              />
            </div>
          )}

          <div className="workspace__content">
            {/* Terminals stay mounted and keep their layout while the file
                manager is open: `visibility` (not `display`) avoids resizing
                xterm to zero, which used to misplace the cursor/IME anchor. */}
            <div className={`terminals${view === "files" ? " terminals--hidden" : ""}`}>
              {tabs.map((tab) => (
                <div
                  key={tab.key}
                  className={`terminal-slot${tab.key === activeKey ? " terminal-slot--active" : ""}`}
                >
                  <TerminalTab
                    state={tab.status.state}
                    terminalId={tab.status.terminalId ?? undefined}
                    reconnectAt={reconnectTicks[tab.key] ?? 0}
                    onReconnect={() => reconnectTab(tab)}
                    sessionId={tab.sessionId}
                    title={tab.title}
                    visible={tab.key === activeKey}
                    theme={theme}
                    fontSize={fontSize}
                    fontFamily={fontFamily}
                    cursorStyle={cursorStyle}
                    cursorWidth={cursorWidth}
                    onStatus={makeStatusHandler(tab.key)}
                  />
                </div>
              ))}
              {(forwardOpen || forwardClosing) && activeTab?.status.terminalId != null && (
                <div className={`sftp-overlay sftp-overlay--forward${forwardClosing ? " sftp-overlay--leave" : ""}`}>
                  <div className="sftp-sheet">
                    <ForwardPanel
                      terminalId={activeTab.status.terminalId}
                      sessionId={activeTab.sessionId}
                      title={activeTab.title}
                    />
                  </div>
                </div>
              )}
              {tabs.length === 0 && mode !== "form" && (
                <div className="workspace__empty">
                  <p>点右上角「＋」新建连接，或从左侧选择一个会话。</p>
                </div>
              )}

            </div>

            {(view === "files" || filesExiting) && (
              <FileManager
                terminalId={activeTab?.status.terminalId ?? null}
                sessionTitle={activeTab?.title ?? null}
                exiting={filesExiting}
                onOpenInTerminal={openInTerminal}
              />
            )}
          </div>
        </main>
      </div>

      <StatusBar
        endpoint={activeTab?.status.endpoint ?? null}
        sessionName={activeTab?.title ?? null}
        state={activeTab?.status.state ?? "closed"}
      />

      {sessionDialog !== null && (
        <NewSessionDialog
          sessions={sessions}
          creating={sessionDialog.creating}
          selected={
            sessionDialog.creating
              ? null
              : (sessions.find((item) => item.id === sessionDialog.selectedId) ?? null)
          }
          onSelect={(session) => setSessionDialog({ creating: false, selectedId: session.id })}
          onCreate={() => setSessionDialog({ creating: true, selectedId: null })}
          onDelete={(session) => setPendingDelete(session)}
          onConnect={(session) => {
            setSessionDialog(null);
            openTab(session);
          }}

          onSaved={() => {
            setSessionDialog(null);
            void refreshSessions();
            setError(null);
          }}
          onSavedAndConnect={(session) => void handleSaved(session)}
          onClose={() => setSessionDialog(null)}
        />
      )}

      {pendingDelete !== null && (
        <ConfirmDialog
          title="删除会话"
          message={`确定删除「${pendingDelete.name}」吗？对应的密码也会从凭据管理器移除。`}
          confirmLabel="删除"
          onConfirm={() => void handleDelete(pendingDelete)}
          onCancel={() => setPendingDelete(null)}
        />
      )}

      {(settingsOpen || settingsClosing) && (
        <SettingsDrawer
          exiting={settingsClosing}
          theme={theme}
          onChangeTheme={setTheme}
          fontSize={fontSize}
          fontFamily={fontFamily}
          onChangeFontFamily={(value) => {
            setFontFamily(value);
            localStorage.setItem("leonssh.fontFamily", value);
          }}
          onChangeFontSize={setFontSize}
          cursorStyle={cursorStyle}
          cursorWidth={cursorWidth}
          onChangeCursorStyle={(style, width) => {
            setCursorStyle(style);
            setCursorWidth(width);
            localStorage.setItem("leonssh.cursorStyle", style);
            localStorage.setItem("leonssh.cursorWidth", String(width));
          }}
          onClose={closeSettings}
        />
      )}
    </div>
  );
}
