import { useCallback, useEffect, useRef, useState } from "react";

import {
  closeEditor,
  processAlive,
  saveEditor,
  tempStat,
  type EditorFile,
} from "../../lib/ipc/editor";
import { toUserMessage } from "../../lib/ipc/errors";

interface ExternalEditorBarProps {
  file: EditorFile;
  /** Called after a successful upload so the file list can refresh. */
  onUploaded: () => void;
  onClose: () => void;
}

/** How often the temp copy is inspected. */
const POLL_MS = 800;
/** A save must be quiet for this long before it is uploaded (editors write in bursts). */
const QUIET_MS = 1500;
/** The editor process is checked less often. */
const ALIVE_EVERY = 3;

type AutoState = "clean" | "pending" | "uploading" | "saved" | "error";

/**
 * Remote file opened with the Windows default application. Saves are detected
 * and uploaded automatically (with a progress bar), and the bar disappears once
 * the external editor window is closed.
 */
export function ExternalEditorBar({ file, onUploaded, onClose }: ExternalEditorBarProps) {
  const [state, setState] = useState<AutoState>("clean");
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [percent, setPercent] = useState<number | null>(null);
  const busyRef = useRef(false);
  const dirtyRef = useRef(false);
  const sawAliveRef = useRef(false);
  const closingRef = useRef(false);

  const uploadNow = useCallback(async () => {
    if (busyRef.current) {
      return;
    }
    busyRef.current = true;
    setState("uploading");
    setPercent(0);
    try {
      const result = await saveEditor(file.editId, (progress) => {
        setPercent(progress.total > 0 ? Math.min(100, (progress.transferred / progress.total) * 100) : null);
      });
      dirtyRef.current = false;
      setSavedAt(new Date().toLocaleTimeString());
      if (result.consistent) {
        setState("saved");
        setError(null);
      } else {
        setState("error");
        setError(result.warning ?? "上传后校验不一致");
      }
      onUploaded();
    } catch (err) {
      setState("error");
      setError(toUserMessage(err));
    } finally {
      busyRef.current = false;
      setPercent(null);
    }
  }, [file.editId, onUploaded]);

  const finish = useCallback(
    async (flush: boolean) => {
      if (closingRef.current) {
        return;
      }
      closingRef.current = true;
      if (flush && dirtyRef.current) {
        await uploadNow();
      }
      await closeEditor(file.editId);
      onClose();
    },
    [file.editId, onClose, uploadNow],
  );

  useEffect(() => {
    let disposed = false;
    let pendingSince: number | null = null;
    let tickCount = 0;

    const tick = async () => {
      if (disposed || busyRef.current || closingRef.current) {
        return;
      }
      // Close the bar when the editor window is gone (after it was seen alive).
      tickCount += 1;
      if (tickCount % ALIVE_EVERY === 0) {
        try {
          const alive = await processAlive(file.editId);
          if (disposed) {
            return;
          }
          if (alive) {
            sawAliveRef.current = true;
          } else if (sawAliveRef.current) {
            await finish(true);
            return;
          }
        } catch {
          // Ignore transient IPC errors.
        }
      }

      try {
        const stat = await tempStat(file.editId);
        if (disposed) {
          return;
        }
        if (stat.changed) {
          dirtyRef.current = true;
          setState((current) => (current === "uploading" ? current : "pending"));
          if (pendingSince === null) {
            pendingSince = Date.now();
          } else if (Date.now() - pendingSince >= QUIET_MS) {
            pendingSince = null;
            await uploadNow();
          }
        } else {
          pendingSince = null;
          dirtyRef.current = false;
          setState((current) =>
            current === "uploading" || current === "error" || current === "saved" ? current : "clean",
          );
        }
      } catch {
        // The temp file can be briefly locked by the editor; retry next tick.
      }
    };

    const timer = window.setInterval(() => void tick(), POLL_MS);
    void tick();
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [file.editId, uploadNow, finish]);

  const label =
    state === "uploading"
      ? "正在上传…"
      : state === "pending"
        ? "检测到修改，等待保存完成…"
        : state === "saved"
          ? `已自动上传 ${savedAt ?? ""}`
          : state === "error"
            ? "上传失败，修改仍保留在临时文件中"
            : "已自动上传（保存后无需手动操作）";

  return (
    <div className="extedit" role="status">
      <span className="extedit__badge">外部编辑</span>
      <span className="extedit__name" title={file.tempPath}>
        {file.name}
      </span>
      <span className={`extedit__state extedit__state--${state}`}>{label}</span>
      {percent !== null && (
        <span className="extedit__progress" aria-label="上传进度">
          <span className="extedit__progress-fill" style={{ width: `${percent}%` }} />
        </span>
      )}
      {error !== null && <span className="extedit__error">{error}</span>}
      <button type="button" className="button button--ghost button--sm" onClick={() => void finish(true)}>
        结束编辑
      </button>
    </div>
  );
}
