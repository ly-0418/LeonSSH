import { useCallback, useEffect, useRef, useState } from "react";

import { closeEditor, saveEditor, tempStat, type EditorFile } from "../../lib/ipc/editor";
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

type AutoState = "clean" | "pending" | "uploading" | "saved" | "error";

/**
 * Remote file opened with the Windows default application. Every save in the
 * external editor is detected and uploaded back automatically — the user never
 * has to choose between keeping and discarding changes.
 */
export function ExternalEditorBar({ file, onUploaded, onClose }: ExternalEditorBarProps) {
  const [state, setState] = useState<AutoState>("clean");
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const busyRef = useRef(false);
  const dirtyRef = useRef(false);

  const uploadNow = useCallback(async () => {
    if (busyRef.current) {
      return;
    }
    busyRef.current = true;
    setState("uploading");
    try {
      const result = await saveEditor(file.editId);
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
    }
  }, [file.editId, onUploaded]);

  useEffect(() => {
    let disposed = false;
    let pendingSince: number | null = null;

    const tick = async () => {
      if (disposed || busyRef.current) {
        return;
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
  }, [file.editId, uploadNow]);

  const finish = useCallback(async () => {
    if (dirtyRef.current) {
      await uploadNow();
    }
    await closeEditor(file.editId);
    onClose();
  }, [file.editId, onClose, uploadNow]);

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
      {error !== null && <span className="extedit__error">{error}</span>}
      <button type="button" className="button button--ghost button--sm" onClick={() => void finish()}>
        结束编辑
      </button>
    </div>
  );
}
