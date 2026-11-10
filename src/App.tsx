import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SmoothMoveMode } from "./lib/terminal/cursor";

import { FileManager } from "./components/file-manager/FileManager";
import { ForwardPanel } from "./components/ForwardPanel";
import { NewSessionDialog } from "./components/NewSessionDialog";
import { SessionForm } from "./components/SessionForm";
import { SettingsDrawer } from "./components/SettingsDrawer";
import { StatusBar } from "./components/StatusBar";
import { TabBar, type TabItem } from "./components/TabBar";
import { SettingsIcon, TransferIcon } from "./components/icons";
import { TerminalTab } from "./components/TerminalTab";
import { ConfirmDialog } from "./components/dialogs";
import { setBroadcastHandler } from "./lib/terminal/TerminalSession";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listTransfers } from "./lib/ipc/transfers";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { startAllForwards } from "./lib/ipc/forwards";
import { toUserMessage } from "./lib/ipc/errors";
import { closeTerminal, writeTerminal } from "./lib/ipc/session";
import { deleteSession, listSessions } from "./lib/ipc/sessions";
import type { SessionSummary, TerminalStatus } from "./lib/ipc/types";
import type { ThemeMode } from "./lib/terminal/theme";
import { appVersion, openExternalUrl } from "./lib/ipc/app";
import { checkForUpdate, type UpdateInfo } from "./lib/update";

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
  // Settings → 配置参数: both action buttons are hidden by default.
  const [showBroadcast, setShowBroadcast] = useState<boolean>(
    () => localStorage.getItem("leonssh.showBroadcast") === "1",
  );
  const [showForward, setShowForward] = useState<boolean>(
    () => localStorage.getItem("leonssh.showForward") === "1",
  );
  const [cursorStyle, setCursorStyle] = useState<"bar" | "underline">(
    () => (localStorage.getItem("leonssh.cursorStyle") === "underline" ? "underline" : "bar"),
  );
  const [cursorWidth, setCursorWidth] = useState<number>(() => {
    const stored = Number.parseInt(localStorage.getItem("leonssh.cursorWidth") ?? "", 10);
    return Number.isFinite(stored) && stored >= 1 && stored <= 6 ? stored : 2;
  });

  // Smooth caret animations (IntelliJ-style); additive to the shape settings.
  const [smoothBlink, setSmoothBlink] = useState<boolean>(
    () => localStorage.getItem("leonssh.cursorSmoothBlink") === "1",
  );
  const [blinkRadius, setBlinkRadius] = useState<number>(() => {
    const stored = Number.parseInt(localStorage.getItem("leonssh.cursorBlinkRadius") ?? "", 10);
    return Number.isFinite(stored) && stored >= 0 && stored <= 8 ? stored : 2;
  });
  const [smoothMove, setSmoothMove] = useState<SmoothMoveMode>(() => {
    const stored = localStorage.getItem("leonssh.cursorSmoothMove");
    return stored === "snappy" || stored === "gliding" ? stored : "off";
  });

  // Stable identity: a new object every render would re-create the terminal
  // session and drop the SSH connection immediately after opening it.
  const cursorSmooth = useMemo(
    () => ({ smoothBlink, blinkRadius, smoothMove }),
    [smoothBlink, blinkRadius, smoothMove],
  );

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
  const [closeRequested, setCloseRequested] = useState(false);
  const forceClose = useRef(false);
  const [pendingClose, setPendingClose] = useState<{ key: string; count: number; finish: () => void } | null>(null);
  const [pendingSessionClose, setPendingSessionClose] = useState<string | null>(null);
  /** Newer release found by the silent startup check. */
  const [updateNotice, setUpdateNotice] = useState<UpdateInfo | null>(null);
  const confirmedSessionClose = useRef<Set<string>>(new Set());
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

  // Silent update check a few seconds after startup: never blocks the UI and
  // stays quiet on network errors. "稍后" remembers the skipped version.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const current = await appVersion();
          const result = await checkForUpdate(current);
          if (result.kind !== "update") {
            return;
          }
          if (localStorage.getItem("leonssh.skippedUpdate") === result.info.version) {
            return;
          }
          setUpdateNotice(result.info);
        } catch {
          // update checks are best effort
        }
      })();
    }, 5000);
    return () => window.clearTimeout(timer);
  }, []);

  // Only live connections block the window close: closed/failed tabs do not.
  const liveSessionCount = tabs.filter(
    (tab) => tab.status.state === "ready" || tab.status.state === "connecting",
  ).length;

  // Closing the window with live sessions asks for confirmation first.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void getCurrentWindow()
      .onCloseRequested((event) => {
        void invoke("frontend_error", { message: `close-requested force=${String(forceClose.current)}` });
        if (forceClose.current) {
          return;
        }
        if (liveSessionCount === 0) {
          return;
        }
        event.preventDefault();
        setCloseRequested(true);
      })
      .then((dispose) => {
        void invoke("frontend_error", { message: "close-listener registered" });
        unlisten = dispose;
      });
    return () => unlisten?.();
  }, [liveSessionCount]);

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

  // The caption ✕ goes through here: no sessions => quit directly, sessions => ask.
  const requestClose = useCallback(() => {
    if (liveSessionCount === 0) {
      void invoke("quit_app");
      return;
    }
    setCloseRequested(true);
  }, [liveSessionCount]);

  const closeTab = useCallback(
    (key: string) => {
      const tab = tabs.find((item) => item.key === key);
      const live =
        tab !== undefined &&
        (tab.status.state === "ready" || tab.status.state === "connecting");
      // A live connection asks first; disconnected/failed tabs close silently.
      if (live && !confirmedSessionClose.current.has(key)) {
        setPendingSessionClose(key);
        return;
      }
      const finish = () => {
        confirmedSessionClose.current.delete(key);
        const next = tabs.filter((item) => item.key !== key);
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
      };
      const terminalId = tab?.status.terminalId ?? null;
      if (terminalId === null) {
        finish();
        return;
      }
      void listTransfers()
        .then((tasks) => {
          const active = tasks.filter(
            (task) =>
              task.terminalId === terminalId &&
              (task.status === "running" || task.status === "queued"),
          );
          if (active.length === 0) {
            finish();
            return;
          }
          setPendingClose({ key, count: active.length, finish });
        })
        .catch(() => finish());
    },
    [tabs, activeKey, sessions.length],
  );

  /** Moves a dragged tab to the drop position (order only, no reconnect). */
  const reorderTabs = useCallback((fromKey: string, toKey: string) => {
    setTabs((current) => {
      const from = current.findIndex((tab) => tab.key === fromKey);
      const to = current.findIndex((tab) => tab.key === toKey);
      if (from < 0 || to < 0 || from === to) {
        return current;
      }
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }, []);

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
      })
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
    window.setTimeout(() => setFilesExiting(false), 380);
  }, []);

  /** Slides the settings drawer out before unmounting it. */
  const closeSettings = useCallback(() => {
    setSettingsClosing(true);
    window.setTimeout(() => {
      setSettingsOpen(false);
      setSettingsClosing(false);
    }, 400);
  }, []);

  /** Slides the forward sheet out to the right. */
  const toggleForward = useCallback(() => {
    if (forwardOpen) {
      setForwardClosing(true);
      window.setTimeout(() => {
        setForwardOpen(false);
        setForwardClosing(false);
    }, 400);
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
        <div className="app-header__title" data-tauri-drag-region>
          LeonSSH
        </div>
        <div className="app-header__actions">
          <button
            type="button"
            className={`header-action header-action--icon${view === "files" ? " header-action--active" : ""}`}
            title="文件传输"
            aria-label="文件传输"
            onClick={() => (view === "files" ? closeFiles() : openFiles())}
          >
            <TransferIcon />
          </button>
          <button
            type="button"
            className={`header-action header-action--icon${settingsOpen ? " header-action--active" : ""}`}
            title="设置"
            aria-label="设置"
            onClick={() => setSettingsOpen((open) => !open)}
          >
            <SettingsIcon />
          </button>
          <span className="app-header__divider" />
          <div className="traffic-lights">
            <button
              type="button"
              className="traffic traffic--min"
              title="最小化"
              aria-label="最小化"
              onClick={() => void getCurrentWindow().minimize()}
            />
            <button
              type="button"
              className="traffic traffic--max"
              title="最大化 / 还原"
              aria-label="最大化或还原"
              onClick={() => void getCurrentWindow().toggleMaximize()}
            />
            <button
              type="button"
              className="traffic traffic--close"
              title="关闭"
              aria-label="关闭"
              onClick={requestClose}
            />
          </div>
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
            showBroadcast={showBroadcast}
            showForward={showForward}
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
            onReorder={reorderTabs}
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
                    cursorSmooth={cursorSmooth}
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

      {closeRequested && (
        <ConfirmDialog
          title="关闭 LeonSSH"
          message={`当前有 ${liveSessionCount} 个会话正在进行，关闭后连接会被断开。确认关闭吗？`}
          confirmLabel="关闭"
          onConfirm={() => {
            setCloseRequested(false);
            forceClose.current = true;
            void invoke("frontend_error", { message: "close-confirmed" });
            void invoke("quit_app");
          }}
          onCancel={() => setCloseRequested(false)}
        />
      )}

      {pendingSessionClose !== null && (
        <ConfirmDialog
          title="关闭会话"
          message={`会话「${tabs.find((item) => item.key === pendingSessionClose)?.title ?? ""}」正在连接中，关闭后将断开连接。确认关闭吗？`}
          confirmLabel="关闭"
          onConfirm={() => {
            const key = pendingSessionClose;
            setPendingSessionClose(null);
            confirmedSessionClose.current.add(key);
            closeTab(key);
          }}
          onCancel={() => setPendingSessionClose(null)}
        />
      )}

      {updateNotice !== null && (
        <div className="modal-backdrop" role="presentation">
          <div className="modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <h2 className="modal__title">发现新版本 v{updateNotice.version}</h2>
            <p className="modal__body">当前版本已落后，更新包通过 GitHub Releases 分发。</p>
            <pre className="update-notes">{updateNotice.notes}</pre>
            <div className="modal__actions">
              <button
                type="button"
                className="button button--primary"
                onClick={() => {
                  void openExternalUrl(updateNotice.url).catch(() => undefined);
                  setUpdateNotice(null);
                }}
              >
                前往下载
              </button>
              <button
                type="button"
                className="button button--ghost"
                onClick={() => {
                  localStorage.setItem("leonssh.skippedUpdate", updateNotice.version);
                  setUpdateNotice(null);
                }}
              >
                稍后提醒
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingClose !== null && (
        <ConfirmDialog
          title="关闭会话"
          message={`该会话有 ${pendingClose.count} 个传输正在进行，关闭会中断它们。确认关闭吗？`}
          confirmLabel="关闭"
          onConfirm={() => {
            const action = pendingClose.finish;
            setPendingClose(null);
            action();
          }}
          onCancel={() => setPendingClose(null)}
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
          smoothBlink={smoothBlink}
          blinkRadius={blinkRadius}
          smoothMove={smoothMove}
          onChangeSmoothBlink={(value) => {
            setSmoothBlink(value);
            localStorage.setItem("leonssh.cursorSmoothBlink", value ? "1" : "0");
          }}
          onChangeBlinkRadius={(value) => {
            setBlinkRadius(value);
            localStorage.setItem("leonssh.cursorBlinkRadius", String(value));
          }}
          onChangeSmoothMove={(value) => {
            setSmoothMove(value);
            localStorage.setItem("leonssh.cursorSmoothMove", value);
          }}
          showBroadcast={showBroadcast}
          showForward={showForward}
          onChangeTabVisibility={(kind, visible) => {
            if (kind === "broadcast") {
              setShowBroadcast(visible);
              localStorage.setItem("leonssh.showBroadcast", visible ? "1" : "0");
            } else {
              setShowForward(visible);
              localStorage.setItem("leonssh.showForward", visible ? "1" : "0");
            }
          }}
          onClose={closeSettings}
        />
      )}
    </div>
  );
}
