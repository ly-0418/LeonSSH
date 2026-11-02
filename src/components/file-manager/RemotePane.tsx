import { useEffect, useMemo, useState } from "react";

import type { FileEntry as PaneEntry } from "../../lib/fs/types";
import { toUserMessage } from "../../lib/ipc/errors";
import {
  closeSftp,
  listRemote,
  openSftp,
  parentPath,
  type FileEntry as RemoteEntry,
} from "../../lib/ipc/sftp";
import { FileTable } from "./FileTable";
import { PathBar } from "./PathBar";
import { useFilePane, type PaneAdapter } from "./useFilePane";

interface RemotePaneProps {
  terminalId: string | null;
  sessionTitle: string | null;
}

/**
 * Right pane. Phase B: remote directory listing over the SFTP subsystem that is
 * opened on the *same* SSH connection as the terminal.
 */
export function RemotePane({ terminalId, sessionTitle }: RemotePaneProps) {
  if (terminalId === null) {
    return (
      <section className="fm-pane fm-pane--placeholder">
        <PlaceholderPathBar />
        <div className="fm-placeholder">
          <p className="fm-placeholder__title">还没有可用的 SSH 会话</p>
          <p className="fm-placeholder__text">先回到终端连接一台服务器，远程面板会自动绑定该连接。</p>
        </div>
        <footer className="fm-pane__foot">
          <span>阶段 B</span>
        </footer>
      </section>
    );
  }
  return <RemotePaneConnected terminalId={terminalId} sessionTitle={sessionTitle} />;
}

function PlaceholderPathBar() {
  return (
    <div className="fm-pathbar">
      <span className="fm-pathbar__label">远程</span>
      <button type="button" className="fm-iconbtn" disabled>
        ↑
      </button>
      <input className="fm-pathbar__input" value="" disabled placeholder="等待 SSH 会话" />
      <button type="button" className="fm-iconbtn" disabled>
        ⟳
      </button>
    </div>
  );
}

function RemotePaneConnected({
  terminalId,
  sessionTitle,
}: {
  terminalId: string;
  sessionTitle: string | null;
}) {
  const [home, setHome] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setHome(null);
    setError(null);
    openSftp(terminalId)
      .then((remoteHome) => {
        if (!cancelled) {
          setHome(remoteHome);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(toUserMessage(err));
        }
      });
    return () => {
      cancelled = true;
      void closeSftp(terminalId);
    };
  }, [terminalId]);

  if (error !== null) {
    return (
      <section className="fm-pane fm-pane--placeholder">
        <PlaceholderPathBar />
        <div className="fm-placeholder">
          <p className="fm-placeholder__title">SFTP 打开失败</p>
          <p className="fm-placeholder__text">{error}</p>
        </div>
        <footer className="fm-pane__foot">
          <span>{sessionTitle ?? "远程"}</span>
        </footer>
      </section>
    );
  }

  if (home === null) {
    return (
      <section className="fm-pane fm-pane--placeholder">
        <PlaceholderPathBar />
        <div className="fm-placeholder">
          <p className="fm-placeholder__title">正在打开 SFTP 子系统…</p>
        </div>
        <footer className="fm-pane__foot">
          <span>{sessionTitle ?? "远程"}</span>
        </footer>
      </section>
    );
  }

  return <RemotePaneLoaded terminalId={terminalId} home={home} sessionTitle={sessionTitle} />;
}

function toPaneEntry(entry: RemoteEntry): PaneEntry {
  return {
    name: entry.name,
    path: entry.path,
    isDir: entry.isDir,
    isSymlink: entry.isSymlink,
    size: entry.size,
    mtimeMs: entry.modified !== null ? entry.modified * 1000 : null,
    permissions: entry.permissions,
  };
}

function RemotePaneLoaded({
  terminalId,
  home,
  sessionTitle,
}: {
  terminalId: string;
  home: string;
  sessionTitle: string | null;
}) {
  const adapter = useMemo<PaneAdapter>(
    () => ({
      // Sorting happens in Rust (directories first, then case-insensitive name).
      list: async (path: string) => (await listRemote(terminalId, path)).map(toPaneEntry),
      home: async () => home,
      parent: parentPath,
    }),
    [terminalId, home],
  );
  const pane = useFilePane(adapter);

  return (
    <section className="fm-pane">
      <PathBar
        label="远程"
        path={pane.path}
        loading={pane.loading}
        onNavigate={(next) => void pane.load(next)}
        onUp={() => void pane.goUp()}
        onRefresh={() => void pane.refresh()}
      />
      <FileTable
        entries={pane.entries}
        selected={pane.selected}
        showPermissions
        loading={pane.loading}
        onSelect={pane.select}
        onOpen={(entry) => {
          if (entry.isDir) {
            void pane.load(entry.path);
          }
        }}
      />
      {pane.error !== null && (
        <button type="button" className="fm-error" onClick={pane.clearError}>
          {pane.error}（点击关闭）
        </button>
      )}
      <footer className="fm-pane__foot">
        <span>{pane.entries.length} 项</span>
        {pane.selected.length > 0 && <span>已选 {pane.selected.length}</span>}
        <span className="fm-pane__foot-end">{sessionTitle ?? ""}</span>
      </footer>
    </section>
  );
}
