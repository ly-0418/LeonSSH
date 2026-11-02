import { useCallback, useEffect, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";

import { isEditableFile } from "../../lib/editor/codemirror";
import type { FileEntry } from "../../lib/fs/types";
import { fileName, joinLocal } from "../../lib/fs/paths";
import { openEditor, type EditorFile } from "../../lib/ipc/editor";
import { toUserMessage } from "../../lib/ipc/errors";
import { joinPath } from "../../lib/ipc/sftp";
import { startDownload, startUpload } from "../../lib/ipc/transfers";
import { EditorPanel } from "./EditorPanel";
import { LocalPane } from "./LocalPane";
import { RemotePane } from "./RemotePane";
import { TransferQueue } from "./TransferQueue";
import { useTransfers } from "./useTransfers";

interface FileManagerProps {
  terminalId: string | null;
  sessionTitle: string | null;
  onBackToTerminal: () => void;
}

/**
 * Dual-pane file manager.
 *
 * Phase C: streaming transfers with resume, a queue with progress/speed/cancel,
 * HTML5 drag (local pane → remote pane) and OS drag-and-drop onto the remote
 * pane. The remote side always reuses the terminal's SSH connection.
 */
export function FileManager({ terminalId, sessionTitle, onBackToTerminal }: FileManagerProps) {
  // Optional deep link: `?view=files&local=C%3A%5CWindows` opens the pane there.
  const initialLocal = new URLSearchParams(window.location.search).get("local") ?? undefined;

  const [localPath, setLocalPath] = useState<string>("");
  const [remotePath, setRemotePath] = useState<string>("");
  const [localSelection, setLocalSelection] = useState<FileEntry[]>([]);
  const [remoteSelection, setRemoteSelection] = useState<FileEntry[]>([]);
  const [dropActive, setDropActive] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorFile | null>(null);
  const [editorRevision, setEditorRevision] = useState(0);
  const { tasks, speeds, error: transferError, revision, clearError, cancel } = useTransfers();

  const upload = useCallback(
    async (sources: FileEntry[]) => {
      if (terminalId === null || remotePath === "") {
        return;
      }
      const files = sources.filter((entry) => !entry.isDir);
      if (files.length === 0) {
        setMessage("请选择文件（目录暂不支持上传）");
        return;
      }
      setMessage(null);
      for (const file of files) {
        try {
          await startUpload(terminalId, file.path, joinPath(remotePath, file.name));
        } catch (err) {
          setMessage(toUserMessage(err));
          break;
        }
      }
    },
    [terminalId, remotePath],
  );

  const download = useCallback(
    async (sources: FileEntry[]) => {
      if (terminalId === null || localPath === "") {
        return;
      }
      const files = sources.filter((entry) => !entry.isDir);
      if (files.length === 0) {
        setMessage("请选择远程文件（目录暂不支持下载）");
        return;
      }
      setMessage(null);
      for (const file of files) {
        try {
          await startDownload(terminalId, file.path, joinLocal(localPath, file.name));
        } catch (err) {
          setMessage(toUserMessage(err));
          break;
        }
      }
    },
    [terminalId, localPath],
  );

  /** Double-click on a remote file: edit text files, download anything else. */
  const openRemote = useCallback(
    async (entry: FileEntry) => {
      if (terminalId === null) {
        return;
      }
      if (!isEditableFile(entry.name)) {
        await download([entry]);
        return;
      }
      try {
        setMessage(null);
        setEditor(await openEditor(terminalId, entry.path));
      } catch (err) {
        setMessage(toUserMessage(err));
      }
    },
    [terminalId, download],
  );

  /** Paths dropped from the OS (Explorer) or dragged from the local pane. */
  const dropPaths = useCallback(
    async (paths: string[]) => {
      if (terminalId === null || remotePath === "") {
        setMessage("远程面板尚未就绪");
        return;
      }
      setMessage(null);
      for (const path of paths) {
        try {
          await startUpload(terminalId, path, joinPath(remotePath, fileName(path)));
        } catch (err) {
          setMessage(toUserMessage(err));
          break;
        }
      }
    },
    [terminalId, remotePath],
  );

  // Native drag-and-drop from the OS: the webview hands us absolute paths.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;

    void getCurrentWebview()
      .onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type === "over") {
          setDropActive(true);
        } else if (payload.type === "drop") {
          setDropActive(false);
          void dropPaths(payload.paths);
        } else {
          setDropActive(false);
        }
      })
      .then((stop) => {
        if (disposed) {
          stop();
        } else {
          unlisten = stop;
        }
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [dropPaths]);

  const banner = message ?? transferError;
  const canUpload = terminalId !== null && remotePath !== "" && localSelection.some((e) => !e.isDir);
  const canDownload =
    terminalId !== null && localPath !== "" && remoteSelection.some((e) => !e.isDir);

  return (
    <div className="file-manager">
      <header className="fm-head">
        <span className="fm-head__title">文件管理</span>
        <button
          type="button"
          className="button button--primary button--sm"
          disabled={!canUpload}
          onClick={() => void upload(localSelection)}
          title="上传选中的本地文件到当前远程目录"
        >
          ↑ 上传
        </button>
        <button
          type="button"
          className="button button--sm"
          disabled={!canDownload}
          onClick={() => void download(remoteSelection)}
          title="下载选中的远程文件到当前本地目录"
        >
          ↓ 下载
        </button>
        <span className="fm-head__hint">
          {terminalId === null
            ? "本地浏览可用；远程面板需要先在终端连接一个会话"
            : `已绑定：${sessionTitle ?? "当前会话"}${remotePath ? ` · ${remotePath}` : ""}`}
        </span>
        <button type="button" className="button button--ghost button--sm" onClick={onBackToTerminal}>
          返回终端
        </button>
      </header>

      {banner !== null && (
        <button
          type="button"
          className="fm-banner"
          onClick={() => {
            setMessage(null);
            clearError();
          }}
        >
          {banner}（点击关闭）
        </button>
      )}

      <div className="fm-panes">
        <LocalPane
          initialPath={initialLocal}
          refreshToken={revision + editorRevision}
          onPathChange={setLocalPath}
          onSelectionChange={setLocalSelection}
          onOpenFile={() => setMessage("双击本地文件不会上传；可选中后点「上传」")}
        />
        <RemotePane
          terminalId={terminalId}
          sessionTitle={sessionTitle}
          dropActive={dropActive}
          refreshToken={revision + editorRevision}
          onPathChange={setRemotePath}
          onSelectionChange={setRemoteSelection}
          onOpenFile={(entry) => void openRemote(entry)}
          onDropPaths={(paths) => void dropPaths(paths)}
        />
      </div>

      <TransferQueue tasks={tasks} speeds={speeds} onCancel={(id) => void cancel(id)} />

      {editor !== null && (
        <EditorPanel
          file={editor}
          onClose={() => setEditor(null)}
          onSaved={() => setEditorRevision((value) => value + 1)}
        />
      )}
    </div>
  );
}

/** Re-exported for tests/consumers that need the task shape. */
export type { FileEntry };
export const __test = { joinLocal, joinPath, fileName };
