import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { SessionForm } from "./components/SessionForm";
import { Sidebar } from "./components/Sidebar";
import { FileManager } from "./components/file-manager/FileManager";
import { ForwardPanel } from "./components/ForwardPanel";
import { StatusBar } from "./components/StatusBar";
import { TabBar, type TabItem } from "./components/TabBar";
import { TerminalTab } from "./components/TerminalTab";
import { ConfirmDialog, KnownHostsDialog } from "./components/dialogs";
import { toUserMessage } from "./lib/ipc/errors";
import { deleteSession, listSessions } from "./lib/ipc/sessions";
import { fetchAppInfo } from "./lib/ipc/session";
import type { AppInfo, SessionSummary, TerminalStatus } from "./lib/ipc/types";

const INITIAL_STATUS: TerminalStatus = {
  terminalId: null,
  renderer: "pending",
  cols: 0,
  rows: 0,
  state: "connecting",
};

const IDLE_STATUS: TerminalStatus = {
  terminalId: null,
  renderer: "pending",
  cols: 0,
  rows: 0,
  state: "closed",
};

export default function App() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [tabs, setTabs] = useState<TabItem[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [mode, setMode] = useState<"terminal" | "form">("terminal");
  const [editing, setEditing] = useState<SessionSummary | null>(null);
  const [pendingDelete, setPendingDelete] = useState<SessionSummary | null>(null);
  const [knownHostsOpen, setKnownHostsOpen] = useState(false);
  const [view, setView] = useState<"terminal" | "files">(() =>
    new URLSearchParams(window.location.search).get("view") === "files" ? "files" : "terminal",
  );
  const [forwardOpen, setForwardOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    fetchAppInfo()
      .then(setInfo)
      .catch((err) => setError(toUserMessage(err)));
  }, [refreshSessions]);

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.key === activeKey) ?? null,
    [tabs, activeKey],
  );

  // Refresh the active-session counter once a terminal is up.
  useEffect(() => {
    if (activeTab?.status.state !== "ready") {
      return;
    }
    let cancelled = false;
    fetchAppInfo()
      .then((value) => {
        if (!cancelled) {
          setInfo(value);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [activeTab?.status.state]);

  const openTab = useCallback(
    (session: SessionSummary) => {
      const existing = tabs.find((tab) => tab.sessionId === session.id);
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

  const closeTab = useCallback(
    (key: string) => {
      const next = tabs.filter((tab) => tab.key !== key);
      setTabs(next);
      if (activeKey === key) {
        setActiveKey(next.length > 0 ? next[next.length - 1].key : null);
      }
      if (next.length === 0 && sessions.length === 0) {
        setMode("form");
      }
    },
    [tabs, activeKey, sessions.length],
  );

  const makeStatusHandler = useCallback(
    (key: string) => (patch: Partial<TerminalStatus>) => {
      setTabs((prev) =>
        prev.map((tab) =>
          tab.key === key ? { ...tab, status: { ...tab.status, ...patch } } : tab,
        ),
      );
    },
    [],
  );

  async function handleSaved(session: SessionSummary) {
    setEditing(null);
    setError(null);
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
    } catch (err) {
      setError(toUserMessage(err));
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="brand__mark">▌</span>
          <h1 className="brand__title">LeonSSH</h1>
          <span className="brand__subtitle">多标签 · SQLite 会话 · 凭据管理器</span>
        </div>
        <div className="app-header__meta">
          <span>{info !== null ? `v${info.version}` : "v—"}</span>
          <span className="app-header__sep" />
          <span>{info !== null ? `${info.platform}/${info.arch}` : "—"}</span>
        </div>
      </header>

      {error !== null && (
        <div className="boot-error" onClick={() => setError(null)} role="presentation">
          {error}（点击关闭）
        </div>
      )}

      <div className="app-body">
        <Sidebar
          view={view}
          onChangeView={setView}
          sessions={sessions}
          activeSessionId={activeTab?.sessionId ?? null}
          onOpen={openTab}
          onCreate={() => {
            setEditing(null);
            setMode("form");
          }}
          onEdit={(session) => {
            setEditing(session);
            setMode("form");
          }}
          onDelete={(session) => setPendingDelete(session)}
          onShowKnownHosts={() => setKnownHostsOpen(true)}
        />

        <main className="workspace">
          {view === "terminal" && (
            <TabBar
              tabs={tabs}
              activeKey={activeKey}
              onActivate={setActiveKey}
              onClose={closeTab}
              forwardOpen={forwardOpen}
              onToggleForward={() => setForwardOpen((open) => !open)}
            />
          )}

          {mode === "form" && view === "terminal" && (
            <div className="workspace__form">
              <SessionForm
                key={editing?.id ?? "new"}
                initial={editing}
                onboarding={sessions.length === 0}
                onSaved={handleSaved}
                onCancel={
                  sessions.length === 0
                    ? undefined
                    : () => {
                        setEditing(null);
                        setMode("terminal");
                      }
                }
              />
            </div>
          )}

          {/* Terminals stay mounted while the file manager is open so that the
              SSH sessions (and their scrollback) survive view switches. */}
          <div
            className={`terminals${
              view === "files" || mode === "form" ? " terminals--hidden" : ""
            }`}
          >
            {tabs.map((tab) => (
              <div
                key={tab.key}
                className={`terminal-slot${tab.key === activeKey ? " terminal-slot--active" : ""}`}
              >
                <TerminalTab
                  sessionId={tab.sessionId}
                  title={tab.title}
                  visible={tab.key === activeKey}
                  onStatus={makeStatusHandler(tab.key)}
                />
              </div>
            ))}
            {tabs.length === 0 && (
              <div className="workspace__empty">
                <p>从左侧选择一个会话，或新建一个。</p>
              </div>
            )}
            {forwardOpen && activeTab?.status.terminalId != null && (
              <div className="sftp-overlay">
                <ForwardPanel
                  terminalId={activeTab.status.terminalId}
                  sessionId={activeTab.sessionId}
                  title={activeTab.title}
                  onClose={() => setForwardOpen(false)}
                />
              </div>
            )}
          </div>

          {view === "files" && (
            <FileManager
              terminalId={activeTab?.status.terminalId ?? null}
              sessionTitle={activeTab?.title ?? null}
              onBackToTerminal={() => setView("terminal")}
            />
          )}
        </main>
      </div>

      <StatusBar status={activeTab?.status ?? IDLE_STATUS} info={info} />

      {pendingDelete !== null && (
        <ConfirmDialog
          title="删除会话"
          message={`确定删除「${pendingDelete.name}」吗？对应的密码也会从凭据管理器移除。`}
          confirmLabel="删除"
          onConfirm={() => void handleDelete(pendingDelete)}
          onCancel={() => setPendingDelete(null)}
        />
      )}

      {knownHostsOpen && <KnownHostsDialog onClose={() => setKnownHostsOpen(false)} />}
    </div>
  );
}
