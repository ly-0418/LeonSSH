import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";

import type { FileEntry } from "../../lib/fs/types";
import { fileName, joinLocal } from "../../lib/fs/paths";
import { openEditorExternal, type EditorFile } from "../../lib/ipc/editor";
import { toUserMessage } from "../../lib/ipc/errors";
import { joinPath, statRemote } from "../../lib/ipc/sftp";
import {
  startDownload,
  startDownloadDir,
  startUpload,
  startUploadDir,
} from "../../lib/ipc/transfers";
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
  onOpenInTerminal?: (path: string) => void;
}

/** Per-session UI memory: paths and layout survive hide/show and tab switches. */
interface FmMemory {
  localPath: string;
  remotePath: string;
  split: number;
  queueHeight: number;
}

const FM_MEMORY = new Map<string, FmMemory>();

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
  onOpenInTerminal,
}: FileManagerProps) {
  // Optional deep link: `?view=files&local=C%3A%5CWindows` opens the pane there.
  const initialLocal = new URLSearchParams(window.location.search).get("local") ?? undefined;

  const memoryKey = terminalId ?? "none";

  const remembered = FM_MEMORY.get(memoryKey);

  const [localPath, setLocalPath] = useState<string>(remembered?.localPath ?? "");
  const [remotePath, setRemotePath] = useState<string>(remembered?.remotePath ?? "");
  const [localSelection, setLocalSelection] = useState<FileEntry[]>([]);
  const [remoteSelection, setRemoteSelection] = useState<FileEntry[]>([]);
  const [dropActive, setDropActive] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorFile | null>(null);
  const [editorRevision, setEditorRevision] = useState(0);
  const [splitPercent, setSplitPercent] = useState(remembered?.split ?? 50);
  const [dragging, setDragging] = useState(false);
  const [queueHeight, setQueueHeight] = useState(remembered?.queueHeight ?? 150);
  const [conflict, setConflict] = useState<{ name: string } | null>(null);
  const conflictResolver = useRef<
    ((choice: "overwrite" | "skip" | "overwrite-all" | "skip-all") => void) | null
  >(null);
  /** Set once the user picks "always overwrite/skip" for the current batch. */
  const conflictPolicy = useRef<"overwrite" | "skip" | null>(null);
  const queueDragRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const panesRef = useRef<HTMLDivElement | null>(null);
  const { tasks, speeds, error: transferError, revision, clearError, cancel } = useTransfers();

  /** Asks the user what to do when the remote file already exists. */
  const askConflict = useCallback(
    (name: string) =>
      new Promise<"overwrite" | "skip" | "overwrite-all" | "skip-all">((resolve) => {
        conflictResolver.current = resolve;
        setConflict({ name });
      }),
    [],
  );

  const resolveConflict = useCallback(
    (choice: "overwrite" | "skip" | "overwrite-all" | "skip-all") => {
    conflictResolver.current?.(choice);
    conflictResolver.current = null;
    setConflict(null);
  }, []);

  /** Uploads one file, asking before overwriting an existing remote file. */
  const uploadOne = useCallback(
    async (localFile: string, name: string) => {
      if (terminalId === null || remotePath === "") {
        return;
      }
      const target = joinPath(remotePath, name);
      let exists = false;
      try {
        await statRemote(terminalId, target);
        exists = true;
      } catch {
        exists = false;
      }
      let overwrite = false;
      if (exists) {
        if (conflictPolicy.current === "skip") {
          return;
        }
        if (conflictPolicy.current === "overwrite") {
          overwrite = true;
        } else {
          const choice = await askConflict(name);
          if (choice === "skip") {
            return;
          }
          if (choice === "skip-all") {
            conflictPolicy.current = "skip";
            return;
          }
          if (choice === "overwrite-all") {
            conflictPolicy.current = "overwrite";
          }
          overwrite = true;
        }
      }
      await startUpload(terminalId, localFile, target, overwrite);
    },
    [terminalId, remotePath, askConflict],
  );

  const upload = useCallback(
    async (sources: FileEntry[]) => {
      if (terminalId === null || remotePath === "") {
        return;
      }
      const files = sources.filter((entry) => !entry.isDir);
      const folders = sources.filter((entry) => entry.isDir);
      if (files.length === 0 && folders.length === 0) {
        setMessage("请选择要上传的文件或文件夹");
        return;
      }
      setMessage(null);
      conflictPolicy.current = null;
      for (const folder of folders) {
        try {
          await startUploadDir(
            terminalId,
            folder.path,
            joinPath(remotePath, folder.name),
          );
        } catch (err) {
          setMessage(toUserMessage(err));
          return;
        }
      }
      for (const file of files) {
        try {
          await uploadOne(file.path, file.name);
        } catch (err) {
          setMessage(toUserMessage(err));
          break;
        }
      }
    },
    [terminalId, remotePath, uploadOne],
  );

  const download = useCallback(
    async (sources: FileEntry[]) => {
      if (terminalId === null || localPath === "") {
        return;
      }
      const files = sources.filter((entry) => !entry.isDir);
      const folders = sources.filter((entry) => entry.isDir);
      if (files.length === 0 && folders.length === 0) {
        setMessage("请选择要下载的文件或文件夹");
        return;
      }
      setMessage(null);
      conflictPolicy.current = null;
      for (const folder of folders) {
        try {
          await startDownloadDir(
            terminalId,
            folder.path,
            joinLocal(localPath, folder.name),
          );
        } catch (err) {
          setMessage(toUserMessage(err));
          return;
        }
      }
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
      conflictPolicy.current = null;
      for (const path of paths) {
        try {
          await uploadOne(path, fileName(path));
        } catch (err) {
          setMessage(toUserMessage(err));
          break;
        }
      }
    },
    [terminalId, remotePath, uploadOne],
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
  // Remember this session's view; restore it when the session changes.
  useEffect(() => {
    FM_MEMORY.set(memoryKey, { localPath, remotePath, split: splitPercent, queueHeight });
  }, [memoryKey, localPath, remotePath, splitPercent, queueHeight]);

  useEffect(() => {
    const saved = FM_MEMORY.get(memoryKey);
    if (saved === undefined) {
      return;
    }
    setLocalPath(saved.localPath);
    setRemotePath(saved.remotePath);
    setSplitPercent(saved.split);
    setQueueHeight(saved.queueHeight);
  }, [memoryKey]);

  const canUpload = terminalId !== null && remotePath !== "" && localSelection.length > 0;
  const canDownload =
    terminalId !== null && localPath !== "" && remoteSelection.length > 0;

  return (
    <div className={`file-manager${exiting ? " file-manager--leave" : " file-manager--enter"}`}>
      <header className="fm-head">
        <button
          type="button"
          className="fm-head__icon-btn fm-head__upload"
          disabled={!canUpload}
          onClick={() => void upload(localSelection)}
          title="上传选中的文件或文件夹（文件夹会递归上传）"
          aria-label="上传"
        >
          <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 16V4" />
            <path d="m7.5 8.5 4.5-4.5 4.5 4.5" />
            <path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15" />
          </svg>
        </button>
        <span className="fm-head__title">文件传输</span>
        <button
          type="button"
          className="fm-head__icon-btn fm-head__download"
          disabled={!canDownload}
          onClick={() => void download(remoteSelection)}
          title="下载选中的远程文件到当前本地目录"
          aria-label="下载"
        >
          <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 4v12" />
            <path d="m7.5 11.5 4.5 4.5 4.5-4.5" />
            <path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15" />
          </svg>
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
          key={memoryKey}
          persistKey={"fm:" + memoryKey + ":local"}
          initialPath={localPath || initialLocal}
          refreshToken={revision + editorRevision}
          onPathChange={(path) => {
            if (path !== "") {
              setLocalPath(path);
            }
          }}
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
          key={memoryKey}
          initialPath={remotePath || undefined}
          persistKey={"fm:" + memoryKey + ":remote"}
          dropActive={dropActive}
          refreshToken={revision + editorRevision}
          onPathChange={(path) => {
            if (path !== "") {
              setRemotePath(path);
            }
          }}
          onSelectionChange={setRemoteSelection}
          onOpenFile={(entry) => void openRemote(entry)}
          onOpenInTerminal={onOpenInTerminal}
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
          terminalId={terminalId ?? ""}
        tasks={tasks}
        speeds={speeds}
        height={queueHeight}
        onCancel={(id) => void cancel(id)}
      />

      {conflict !== null && (
        <div className="modal-backdrop" role="presentation">
          <div className="modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <h2 className="modal__title">远程文件已存在</h2>
            <p className="modal__body">
              远程目录中已有「{conflict.name}」，要覆盖还是跳过这个文件？
            </p>
            <div className="modal__actions">
              <button
                type="button"
                className="button button--primary"
                onClick={() => resolveConflict("overwrite")}
              >
                覆盖
              </button>
              <button
                type="button"
                className="button button--ghost"
                onClick={() => resolveConflict("skip")}
              >
                跳过
              </button>
              <button
                type="button"
                className="button button--ghost"
                onClick={() => resolveConflict("overwrite-all")}
              >
                以后都覆盖
              </button>
              <button
                type="button"
                className="button button--ghost"
                onClick={() => resolveConflict("skip-all")}
              >
                以后都跳过
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
