import { useCallback, useEffect, useState } from "react";

import { closeEditor, saveEditor, tempStat, type EditorFile } from "../../lib/ipc/editor";
import { toUserMessage } from "../../lib/ipc/errors";

interface ExternalEditorBarProps {
  file: EditorFile;
  /** Called after a successful upload so the file list can refresh. */
  onUploaded: () => void;
  onClose: () => void;
}

const POLL_MS = 1500;

/**
 * Remote file opened with the Windows default application: the temp copy is
 * polled for changes and uploaded back on demand.
 */
export function ExternalEditorBar({ file, onUploaded, onClose }: ExternalEditorBarProps) {
  const [changed, setChanged] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    const tick = async () => {
      try {
        const stat = await tempStat(file.editId);
        if (!disposed) {
          setChanged(stat.changed);
        }
      } catch {
        // The temp file may be gone while the editor holds it; ignore.
      }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), POLL_MS);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [file.editId]);

  const upload = useCallback(async () => {
    setUploading(true);
    setError(null);
    try {
      const result = await saveEditor(file.editId);
      setChanged(false);
      setSavedAt(new Date().toLocaleTimeString());
      if (!result.consistent && result.warning !== null) {
        setError(result.warning);
      }
      onUploaded();
    } catch (err) {
      setError(toUserMessage(err));
    } finally {
      setUploading(false);
    }
  }, [file.editId, onUploaded]);

  const finish = useCallback(async () => {
    await closeEditor(file.editId);
    onClose();
  }, [file.editId, onClose]);

  return (
    <div className="extedit" role="status">
      <span className="extedit__badge">外部编辑</span>
      <span className="extedit__name" title={file.tempPath}>
        {file.name}
      </span>
      <span className={`extedit__state${changed ? " extedit__state--dirty" : ""}`}>
        {changed ? "● 有修改，未上传" : savedAt !== null ? `已上传 ${savedAt}` : "未修改"}
      </span>
      {error !== null && <span className="extedit__error">{error}</span>}
      <button
        type="button"
        className="button button--primary button--sm"
        disabled={uploading || !changed}
        onClick={() => void upload()}
      >
        {uploading ? "上传中…" : "上传修改"}
      </button>
      <button type="button" className="button button--ghost button--sm" onClick={() => void finish()}>
        结束编辑
      </button>
    </div>
  );
}
