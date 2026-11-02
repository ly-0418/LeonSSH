import { useCallback, useEffect, useState } from "react";

import { toUserMessage } from "../lib/ipc/errors";
import {
  chmodRemote,
  closeSftp,
  downloadFile,
  formatMode,
  formatSize,
  joinPath,
  listLocal,
  listRemote,
  localHome,
  mkdirRemote,
  openSftp,
  parentPath,
  removeRemote,
  renameRemote,
  uploadFile,
  type FileEntry,
  type TransferProgress,
} from "../lib/ipc/sftp";
import { ConfirmDialog } from "./dialogs";

interface PaneState {
  path: string;
  entries: FileEntry[];
  selected: string | null;
  error: string | null;
}

interface SftpPanelProps {
  terminalId: string;
  title: string;
  onClose: () => void;
}

type PromptKind = "mkdir" | "rename" | "chmod" | null;

export function SftpPanel({ terminalId, title, onClose }: SftpPanelProps) {
  const [local, setLocal] = useState<PaneState>({ path: "", entries: [], selected: null, error: null });
  const [remote, setRemote] = useState<PaneState>({ path: "", entries: [], selected: null, error: null });
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<TransferProgress | null>(null);
  const [prompt, setPrompt] = useState<PromptKind>(null);
  const [promptValue, setPromptValue] = useState("");
  const [pendingRemove, setPendingRemove] = useState<{ path: string; isDir: boolean; name: string } | null>(null);

  const loadLocal = useCallback(async (path: string) => {
    try {
      const entries = await listLocal(path);
      setLocal((prev) => ({ ...prev, path, entries, error: null }));
    } catch (error) {
      setLocal((prev) => ({ ...prev, error: toUserMessage(error) }));
    }
  }, []);

  const loadRemote = useCallback(
    async (path: string) => {
      try {
        const entries = await listRemote(terminalId, path);
        setRemote((prev) => ({ ...prev, path, entries, error: null }));
      } catch (error) {
        setRemote((prev) => ({ ...prev, error: toUserMessage(error) }));
      }
    },
    [terminalId],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const home = await localHome();
        if (!cancelled) {
          await loadLocal(home);
        }
        const remoteHome = await openSftp(terminalId);
        if (!cancelled) {
          await loadRemote(remoteHome);
        }
      } catch (error) {
        if (!cancelled) {
          setRemote((prev) => ({ ...prev, error: toUserMessage(error) }));
        }
      }
    })();
    return () => {
      cancelled = true;
      void closeSftp(terminalId);
    };
  }, [terminalId, loadLocal, loadRemote]);

  function describe(entry: FileEntry): string {
    if (entry.isDir) {
      return "目录";
    }
    const mode = entry.permissions === null ? "" : ` · ${formatMode(entry.permissions)}`;
    return `${formatSize(entry.size)}${mode}`;
  }

  function onPaneClick(
    side: "local" | "remote",
    entry: FileEntry,
    setter: (state: PaneState) => void,
    load: (path: string) => Promise<void>,
    current: PaneState,
  ) {
    if (entry.isDir) {
      setter({ ...current, selected: null });
      void load(entry.path);
      return;
    }
    setter({ ...current, selected: entry.path });
    void side;
  }

  function selectedEntry(state: PaneState): FileEntry | null {
    return state.entries.find((entry) => entry.path === state.selected) ?? null;
  }

  async function handleUpload() {
    const entry = selectedEntry(local);
    if (!entry || entry.isDir) {
      return;
    }
    setBusy(true);
    setProgress({ transferred: 0, total: entry.size, done: false, message: null });
    try {
      await uploadFile(terminalId, entry.path, joinPath(remote.path, entry.name), setProgress);
      await loadRemote(remote.path);
    } catch (error) {
      setRemote((prev) => ({ ...prev, error: toUserMessage(error) }));
    } finally {
      setBusy(false);
    }
  }

  async function handleDownload() {
    const entry = selectedEntry(remote);
    if (!entry || entry.isDir) {
      return;
    }
    setBusy(true);
    setProgress({ transferred: 0, total: entry.size, done: false, message: null });
    try {
      await downloadFile(terminalId, entry.path, joinPath(local.path, entry.name), setProgress);
      await loadLocal(local.path);
    } catch (error) {
      setLocal((prev) => ({ ...prev, error: toUserMessage(error) }));
    } finally {
      setBusy(false);
    }
  }

  async function submitPrompt() {
    const kind = prompt;
    const value = promptValue.trim();
    setPrompt(null);
    if (kind === null || value.length === 0) {
      return;
    }
    try {
      if (kind === "mkdir") {
        await mkdirRemote(terminalId, joinPath(remote.path, value));
      } else if (kind === "rename") {
        const entry = selectedEntry(remote);
        if (entry) {
          await renameRemote(terminalId, entry.path, joinPath(remote.path, value));
        }
      } else if (kind === "chmod") {
        const entry = selectedEntry(remote);
        const mode = Number.parseInt(value, 8);
        if (entry && Number.isFinite(mode)) {
          await chmodRemote(terminalId, entry.path, mode);
        }
      }
      await loadRemote(remote.path);
    } catch (error) {
      setRemote((prev) => ({ ...prev, error: toUserMessage(error) }));
    }
  }

  async function confirmRemove() {
    if (!pendingRemove) {
      return;
    }
    const target = pendingRemove;
    setPendingRemove(null);
    try {
      await removeRemote(terminalId, target.path, target.isDir);
      await loadRemote(remote.path);
    } catch (error) {
      setRemote((prev) => ({ ...prev, error: toUserMessage(error) }));
    }
  }

  const selectedRemote = selectedEntry(remote);

  return (
    <div className="sftp">
      <header className="sftp__head">
        <span className="sftp__title">SFTP · {title}</span>
        <span className="sftp__hint">复用当前 SSH 连接，不额外建立连接</span>
        <button type="button" className="button button--ghost button--sm" onClick={onClose}>
          关闭
        </button>
      </header>

      <div className="sftp__body">
        <section className="pane">
          <div className="pane__head">
            <button
              type="button"
              className="pane__up"
              onClick={() => void loadLocal(parentPath(local.path))}
              disabled={local.path === "" }
            >
              ↑
            </button>
            <span className="pane__path" title={local.path}>
              本地 · {local.path}
            </span>
          </div>
          <ul className="pane__list">
            {local.entries.map((entry) => (
              <li
                key={entry.path}
                className={`pane__item${entry.path === local.selected ? " pane__item--active" : ""}`}
                onClick={() => onPaneClick("local", entry, setLocal, loadLocal, local)}
                onDoubleClick={() => {
                  if (entry.isDir) {
                    void loadLocal(entry.path);
                  }
                }}
              >
                <span className="pane__icon">{entry.isDir ? "📁" : "📄"}</span>
                <span className="pane__name">{entry.name}</span>
                <span className="pane__meta">{describe(entry)}</span>
              </li>
            ))}
          </ul>
          {local.error !== null && <p className="pane__error">{local.error}</p>}
        </section>

        <section className="pane">
          <div className="pane__head">
            <button
              type="button"
              className="pane__up"
              onClick={() => void loadRemote(parentPath(remote.path))}
              disabled={remote.path === ""}
            >
              ↑
            </button>
            <span className="pane__path" title={remote.path}>
              远程 · {remote.path}
            </span>
          </div>
          <ul className="pane__list">
            {remote.entries.map((entry) => (
              <li
                key={entry.path}
                className={`pane__item${entry.path === remote.selected ? " pane__item--active" : ""}`}
                onClick={() => onPaneClick("remote", entry, setRemote, loadRemote, remote)}
                onDoubleClick={() => {
                  if (entry.isDir) {
                    void loadRemote(entry.path);
                  }
                }}
              >
                <span className="pane__icon">{entry.isDir ? "📁" : "📄"}</span>
                <span className="pane__name">{entry.name}</span>
                <span className="pane__meta">{describe(entry)}</span>
              </li>
            ))}
          </ul>
          {remote.error !== null && <p className="pane__error">{remote.error}</p>}
        </section>
      </div>

      <footer className="sftp__foot">
        <button type="button" className="button button--primary button--sm" onClick={() => void handleUpload()} disabled={busy}>
          ↑ 上传
        </button>
        <button type="button" className="button button--sm" onClick={() => void handleDownload()} disabled={busy}>
          ↓ 下载
        </button>
        <button
          type="button"
          className="button button--ghost button--sm"
          onClick={() => {
            setPromptValue("");
            setPrompt("mkdir");
          }}
        >
          新建目录
        </button>
        <button
          type="button"
          className="button button--ghost button--sm"
          disabled={selectedRemote === null}
          onClick={() => {
            setPromptValue(selectedRemote?.name ?? "");
            setPrompt("rename");
          }}
        >
          重命名
        </button>
        <button
          type="button"
          className="button button--ghost button--sm"
          disabled={selectedRemote === null}
          onClick={() => {
            setPromptValue(formatMode(selectedRemote?.permissions ?? 0o644));
            setPrompt("chmod");
          }}
        >
          权限
        </button>
        <button
          type="button"
          className="button button--danger button--sm"
          disabled={selectedRemote === null}
          onClick={() => {
            if (selectedRemote) {
              setPendingRemove({
                path: selectedRemote.path,
                isDir: selectedRemote.isDir,
                name: selectedRemote.name,
              });
            }
          }}
        >
          删除
        </button>

        <span className="sftp__progress">
          {progress !== null
            ? `${progress.done ? "完成" : "传输中"} ${formatSize(progress.transferred)}${
                progress.total > 0 ? ` / ${formatSize(progress.total)}` : ""
              }`
            : ""}
        </span>
      </footer>

      {prompt !== null && (
        <div className="modal-backdrop" role="presentation" onClick={() => setPrompt(null)}>
          <div className="modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <h2 className="modal__title">
              {prompt === "mkdir" ? "新建目录" : prompt === "rename" ? "重命名" : "修改权限（八进制）"}
            </h2>
            <input
              className="input"
              autoFocus
              value={promptValue}
              onChange={(event) => setPromptValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void submitPrompt();
                }
                if (event.key === "Escape") {
                  setPrompt(null);
                }
              }}
            />
            <div className="modal__actions">
              <button type="button" className="button button--primary" onClick={() => void submitPrompt()}>
                确定
              </button>
              <button type="button" className="button button--ghost" onClick={() => setPrompt(null)}>
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingRemove !== null && (
        <ConfirmDialog
          title="删除远端文件"
          message={`确定删除「${pendingRemove.name}」吗？`}
          confirmLabel="删除"
          onConfirm={() => void confirmRemove()}
          onCancel={() => setPendingRemove(null)}
        />
      )}
    </div>
  );
}
