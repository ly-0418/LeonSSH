import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";

import type { FileEntry } from "../../lib/fs/types";
import { fileName, joinLocal } from "../../lib/fs/paths";
import { openEditorExternal, type EditorFile } from "../../lib/ipc/editor";
import { toUserMessage } from "../../lib/ipc/errors";
import { joinPath } from "../../lib/ipc/sftp";
import { startDownload, startUpload } from "../../lib/ipc/transfers";
import { ExternalEditorBar } from "./ExternalEditorBar";
import { LocalPane } from "./LocalPane";
import { RemotePane } from "./RemotePane";
import { TransferQueue } from "./TransferQueue";
import { useTransfers } from "./useTransfers";

interface FileManagerProps {
  terminalId: string | null;
  sessionTitle: string | null;
  /** Playing the slide-up exit animation; stays mounted until it ends. */
  exiting?: boolean;
  onBackToTerminal: () => void;
}

const MIN_SPLIT = 20;
const MAX_SPLIT = 80;

/**
 * Dual-pane file manager with a draggable splitter, streaming transfers,
 * drag-and-drop and the remote editor drawer.
 */
export function FileManager({
  terminalId,
  sessionTitle,
  exiting = false,
  onBackToTerminal,
}: FileManagerProps) {
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
  const [splitPercent, setSplitPercent] = useState(50);
  const [dragging, setDragging] = useState(false);
  const [queueHeight, setQueueHeight] = useState(150);
  const queueDragRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const panesRef = useRef<HTMLDivElement | null>(null);
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

  /** Double-click on a remote file: open it with the Windows default app. */
  const openRemote = useCallback(
    async (entry: FileEntry) => {
      if (terminalId === null) {
        return;
      }
      try {
        setMessage(null);
        setEditor(await openEditorExternal(terminalId, entry.path));
      } catch (err) {
        setMessage(toUserMessage(err));
      }
    },
    [terminalId],
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

  // Pointer-based drag from the local pane onto the remote pane. HTML5 DnD was
  // unreliable inside WebView2, so we track the pointer ourselves and check the
  // drop target with elementFromPoint.
  const beginDrag = useCallback(
    (entry: FileEntry, event: React.PointerEvent) => {
      if (entry.isDir || event.button !== 0) {
        return;
      }
      const startX = event.clientX;
      const startY = event.clientY;
      let active = false;

      const move = (moveEvent: PointerEvent) => {
        if (!active && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) > 6) {
          active = true;
          setDropActive(true);
        }
      };
      const up = (upEvent: PointerEvent) => {
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", up);
        setDropActive(false);
        if (!active) {
          return;
        }
        const element = document.elementFromPoint(upEvent.clientX, upEvent.clientY);
        const target = element instanceof Element ? element.closest("[data-drop-remote]") : null;
        if (target !== null) {
          void dropPaths([entry.path]);
        }
      };

      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", up);
    },
    [dropPaths],
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

  // Splitter drag: clamp to a usable range so neither pane can disappear.
  const onSplitterMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (panesRef.current === null) {
      return;
    }
    const rect = panesRef.current.getBoundingClientRect();
    if (rect.width <= 0) {
      return;
    }
    const percent = ((event.clientX - rect.left) / rect.width) * 100;
    setSplitPercent(Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, percent)));
  }, []);

  const banner = message ?? transferError;
  const canUpload = terminalId !== null && remotePath !== "" && localSelection.some((e) => !e.isDir);
  const canDownload =
    terminalId !== null && localPath !== "" && remoteSelection.some((e) => !e.isDir);

  return (
    <div className={`file-manager${exiting ? " file-manager--leave" : " file-manager--enter"}`}>
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

      <div
        className={`fm-panes${dragging ? " fm-panes--dragging" : ""}`}
        ref={panesRef}
        style={{ gridTemplateColumns: `${splitPercent}% 6px 1fr` }}
      >
        <LocalPane
          initialPath={initialLocal}
          refreshToken={revision + editorRevision}
          onPathChange={setLocalPath}
          onSelectionChange={setLocalSelection}
          onRowPointerDown={beginDrag}
        />
        <div
          className="fm-splitter"
          role="separator"
          aria-orientation="vertical"
          aria-label="调整左右面板宽度"
          onPointerDown={(event) => {
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            setDragging(true);
          }}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              onSplitterMove(event);
            }
          }}
          onPointerUp={(event) => {
            event.currentTarget.releasePointerCapture(event.pointerId);
            setDragging(false);
          }}
          onPointerCancel={() => setDragging(false)}
          onDoubleClick={() => setSplitPercent(50)}
          title="拖动调整左右宽度（双击恢复 50/50）"
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

      <div
        className="fq-splitter"
        role="separator"
        aria-orientation="horizontal"
        aria-label="调整传输队列高度"
        title="拖动调整下方传输队列高度（双击恢复默认）"
        onDoubleClick={() => setQueueHeight(150)}
        onPointerDown={(event) => {
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          queueDragRef.current = { startY: event.clientY, startHeight: queueHeight };
        }}
        onPointerMove={(event) => {
          const drag = queueDragRef.current;
          if (drag === null || !event.currentTarget.hasPointerCapture(event.pointerId)) {
            return;
          }
          const next = drag.startHeight - (event.clientY - drag.startY);
          setQueueHeight(Math.min(520, Math.max(60, next)));
        }}
        onPointerUp={(event) => {
          event.currentTarget.releasePointerCapture(event.pointerId);
          queueDragRef.current = null;
        }}
        onPointerCancel={() => {
          queueDragRef.current = null;
        }}
      />

      {editor !== null && (
        <ExternalEditorBar
          file={editor}
          onClose={() => setEditor(null)}
          onUploaded={() => setEditorRevision((value) => value + 1)}
        />
      )}

      <TransferQueue
        tasks={tasks}
        speeds={speeds}
        height={queueHeight}
        onCancel={(id) => void cancel(id)}
      />
    </div>
  );
}
