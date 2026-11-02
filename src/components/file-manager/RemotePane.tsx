import { useEffect, useMemo, useRef, useState } from "react";

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
  /** Highlight when a native drag from the OS is over the pane. */
  dropActive?: boolean;
  refreshToken?: number;
  onPathChange?: (path: string) => void;
  onSelectionChange?: (entries: PaneEntry[]) => void;
  onOpenFile?: (entry: PaneEntry) => void;
  /** Upload local paths (HTML5 drag from the local pane, or OS drop). */
  onDropPaths?: (paths: string[]) => void;
}

/**
 * Right pane: remote directory listing over the SFTP subsystem opened on the
 * *same* SSH connection as the terminal.
 */
export function RemotePane({
  terminalId,
  sessionTitle,
  dropActive = false,
  refreshToken,
  onPathChange,
  onSelectionChange,
  onOpenFile,
  onDropPaths,
}: RemotePaneProps) {
  if (terminalId === null) {
    return (
      <section className="fm-pane fm-pane--placeholder">
        <PlaceholderPathBar />
        <div className="fm-placeholder">
          <p className="fm-placeholder__title">还没有可用的 SSH 会话</p>
          <p className="fm-placeholder__text">先回到终端连接一台服务器，远程面板会自动绑定该连接。</p>
        </div>
        <footer className="fm-pane__foot">
          <span>远程</span>
        </footer>
      </section>
    );
  }
  return (
    <RemotePaneConnected
      terminalId={terminalId}
      sessionTitle={sessionTitle}
      dropActive={dropActive}
      refreshToken={refreshToken}
      onPathChange={onPathChange}
      onSelectionChange={onSelectionChange}
      onOpenFile={onOpenFile}
      onDropPaths={onDropPaths}
    />
  );
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
  dropActive,
  refreshToken,
  onPathChange,
  onSelectionChange,
  onOpenFile,
  onDropPaths,
}: {
  terminalId: string;
  sessionTitle: string | null;
  dropActive: boolean;
  refreshToken?: number;
  onPathChange?: (path: string) => void;
  onSelectionChange?: (entries: PaneEntry[]) => void;
  onOpenFile?: (entry: PaneEntry) => void;
  onDropPaths?: (paths: string[]) => void;
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

  return (
    <RemotePaneLoaded
      terminalId={terminalId}
      home={home}
      sessionTitle={sessionTitle}
      dropActive={dropActive}
      refreshToken={refreshToken}
      onPathChange={onPathChange}
      onSelectionChange={onSelectionChange}
      onOpenFile={onOpenFile}
      onDropPaths={onDropPaths}
    />
  );
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
  dropActive,
  refreshToken,
  onPathChange,
  onSelectionChange,
  onOpenFile,
  onDropPaths,
}: {
  terminalId: string;
  home: string;
  sessionTitle: string | null;
  dropActive?: boolean;
  refreshToken?: number;
  onPathChange?: (path: string) => void;
  onSelectionChange?: (entries: PaneEntry[]) => void;
  onOpenFile?: (entry: PaneEntry) => void;
  onDropPaths?: (paths: string[]) => void;
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

  useEffect(() => {
    onPathChange?.(pane.path);
  }, [pane.path, onPathChange]);

  useEffect(() => {
    onSelectionChange?.(pane.selectedEntries);
  }, [pane.selectedEntries, onSelectionChange]);

  const refreshRef = useRef(pane.refresh);
  refreshRef.current = pane.refresh;
  useEffect(() => {
    if (refreshToken !== undefined && refreshToken > 0) {
      void refreshRef.current();
    }
  }, [refreshToken]);

  return (
    <section
      className={`fm-pane${dropActive === true ? " fm-pane--drop" : ""}`}
      onDragOver={(event) => {
        if (onDropPaths !== undefined) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }
      }}
      onDrop={(event) => {
        if (onDropPaths === undefined) {
          return;
        }
        event.preventDefault();
        const custom = event.dataTransfer.getData("application/x-leonssh-path");
        const text = custom.length > 0 ? custom : event.dataTransfer.getData("text/plain");
        const paths = text
          .split("\n")
          .map((value) => value.trim())
          .filter((value) => value.length > 0);
        if (paths.length > 0) {
          onDropPaths(paths);
        }
      }}
    >
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
          } else {
            onOpenFile?.(entry);
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
