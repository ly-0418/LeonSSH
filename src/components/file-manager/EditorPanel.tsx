import { useEffect, useRef, useState } from "react";
import type { EditorView } from "@codemirror/view";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";

import { createEditor } from "../../lib/editor/codemirror";
import {
  closeEditor,
  saveEditor,
  saveEditorAs,
  type EditorFile,
} from "../../lib/ipc/editor";
import { toUserMessage } from "../../lib/ipc/errors";
import { ConfirmDialog } from "../dialogs";

interface EditorPanelProps {
  file: EditorFile;
  onClose: () => void;
  /** Called after a successful save so the file list can refresh. */
  onSaved: () => void;
}

/**
 * Remote file editor: the text lives in an app-managed temp file, CodeMirror
 * edits it, and saving streams it back over the SFTP session.
 */
export function EditorPanel({ file, onClose, onSaved }: EditorPanelProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);

  const [remotePath, setRemotePath] = useState(file.remotePath);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [saveAsOpen, setSaveAsOpen] = useState(false);
  const [saveAsPath, setSaveAsPath] = useState("");

  useEffect(() => {
    let disposed = false;
    void (async () => {
      try {
        const text = await readTextFile(file.tempPath);
        if (disposed || hostRef.current === null) {
          return;
        }
        viewRef.current = await createEditor(hostRef.current, text, file.name, () => setDirty(true));
      } catch (err) {
        if (!disposed) {
          setError(toUserMessage(err));
        }
      }
    })();
    return () => {
      disposed = true;
      viewRef.current?.destroy();
      viewRef.current = null;
    };
  }, [file.editId, file.name, file.tempPath]);

  async function handleSave(target?: string) {
    const view = viewRef.current;
    if (view === null) {
      return;
    }
    setSaving(true);
    setError(null);
    setWarning(null);
    try {
      await writeTextFile(file.tempPath, view.state.doc.toString());
      const result = target === undefined
        ? await saveEditor(file.editId)
        : await saveEditorAs(file.editId, target);
      setRemotePath(result.remotePath);
      setDirty(false);
      if (!result.consistent && result.warning !== null) {
        setWarning(result.warning);
      }
      if (target !== undefined) {
        setSaveAsOpen(false);
        setSaveAsPath("");
      }
      onSaved();
    } catch (err) {
      setError(toUserMessage(err));
    } finally {
      setSaving(false);
    }
  }

  function requestClose() {
    if (dirty) {
      setConfirmDiscard(true);
      return;
    }
    void finishClose();
  }

  async function finishClose() {
    viewRef.current?.destroy();
    viewRef.current = null;
    await closeEditor(file.editId);
    onClose();
  }

  return (
    <div className="editor">
      <header className="editor__head">
        <span className="editor__badge">远程文件</span>
        <span className="editor__name">{file.name}</span>
        <span className="editor__path" title={remotePath}>
          {remotePath}
        </span>
        {dirty && <span className="editor__dirty">● 未保存</span>}
        <span className="editor__spacer" />
        <button
          type="button"
          className="button button--primary button--sm"
          disabled={saving}
          onClick={() => void handleSave()}
        >
          {saving ? "保存中…" : "保存"}
        </button>
        <button
          type="button"
          className="button button--sm"
          disabled={saving}
          onClick={() => {
            setSaveAsPath(remotePath);
            setSaveAsOpen(true);
          }}
        >
          另存为
        </button>
        <button type="button" className="button button--ghost button--sm" onClick={requestClose}>
          关闭
        </button>
      </header>

      {error !== null && (
        <button type="button" className="fm-banner" onClick={() => setError(null)}>
          {error}（点击关闭）
        </button>
      )}
      {warning !== null && (
        <button type="button" className="fm-banner fm-banner--warn" onClick={() => setWarning(null)}>
          {warning}（点击关闭）
        </button>
      )}

      <div className="editor__host" ref={hostRef} />
      <footer className="editor__foot">
        <span>临时文件：{file.tempPath}</span>
        <span className="fm-pane__foot-end">保存时按字节流覆盖远端文件</span>
      </footer>

      {confirmDiscard && (
        <ConfirmDialog
          title="放弃未保存的修改？"
          message="关闭后临时文件会被删除，未保存的内容无法恢复。"
          confirmLabel="放弃并关闭"
          onConfirm={() => {
            setConfirmDiscard(false);
            void finishClose();
          }}
          onCancel={() => setConfirmDiscard(false)}
        />
      )}

      {saveAsOpen && (
        <div className="modal-backdrop" role="presentation" onClick={() => setSaveAsOpen(false)}>
          <div className="modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <h2 className="modal__title">另存为远程路径</h2>
            <input
              className="input"
              autoFocus
              value={saveAsPath}
              onChange={(event) => setSaveAsPath(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && saveAsPath.trim().length > 0) {
                  void handleSave(saveAsPath.trim());
                } else if (event.key === "Escape") {
                  setSaveAsOpen(false);
                }
              }}
            />
            <div className="modal__actions">
              <button
                type="button"
                className="button button--primary"
                disabled={saving || saveAsPath.trim().length === 0}
                onClick={() => void handleSave(saveAsPath.trim())}
              >
                保存
              </button>
              <button type="button" className="button button--ghost" onClick={() => setSaveAsOpen(false)}>
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
