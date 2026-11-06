import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { FileEntry as PaneEntry } from "../../lib/fs/types";
import { toUserMessage } from "../../lib/ipc/errors";
import {
  createRemoteFile,
  copyRemote,
  joinPath,
  listRemote,
  listRemoteStream,
  mkdirRemote,
  openSftp,
  parentPath,
  removeRemote,
  renameRemote,
  chmodRemote,
  type FileEntry as RemoteEntry,
} from "../../lib/ipc/sftp";
import { ConfirmDialog } from "../dialogs";
import { FileContextMenu, type FileMenuItem } from "./FileContextMenu";
import { FileTable } from "./FileTable";
import { PathBar } from "./PathBar";
import { PromptDialog } from "./PromptDialog";
import { useFilePane, type PaneAdapter } from "./useFilePane";

interface RemotePaneProps {
  terminalId: string | null;
  sessionTitle: string | null;
  /** Highlight when a drag from the local pane (or the OS) is over the pane. */
  dropActive?: boolean;
  refreshToken?: number;
  initialPath?: string;
  persistKey?: string;
  onPathChange?: (path: string) => void;
  onSelectionChange?: (entries: PaneEntry[]) => void;
  onOpenFile?: (entry: PaneEntry) => void;
  onDropPaths?: (paths: string[]) => void;
  onRowPointerDown?: (entry: PaneEntry, event: React.PointerEvent) => void;
  onOpenInTerminal?: (path: string) => void;
}

type PaneHooks = Omit<RemotePaneProps, "terminalId" | "sessionTitle">;

/**
 * Right pane: remote directory listing over the SFTP subsystem opened on the
 * *same* SSH connection as the terminal.
 */
export function RemotePane({
  terminalId,
  sessionTitle,
  ...hooks
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
    <RemotePaneConnected terminalId={terminalId} sessionTitle={sessionTitle} {...hooks} />
  );
}

function PlaceholderPathBar() {
  return (
    <div className="fm-pathbar">
      <span className="fm-pathbar__label">远程</span>
      <button type="button" className="fm-iconbtn" disabled>
        ↑
      </button>
      <div className="fm-pathbar__field">
        <input className="fm-pathbar__input" value="" disabled placeholder="等待 SSH 会话" />
      </div>
      <button type="button" className="fm-iconbtn" disabled>
        ⟳
      </button>
      <input className="fm-pathbar__search" value="" disabled placeholder="搜索当前目录" />
    </div>
  );
}

function RemotePaneConnected({
  terminalId,
  sessionTitle,
  ...hooks
}: { terminalId: string; sessionTitle: string | null } & PaneHooks) {
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

  return <RemotePaneLoaded terminalId={terminalId} home={home} sessionTitle={sessionTitle} {...hooks} />;
}

type RemotePrompt =
  | { kind: "folder" }
  | { kind: "file" }
  | { kind: "rename"; entry: PaneEntry };

function isRenamePrompt(prompt: RemotePrompt): prompt is { kind: "rename"; entry: PaneEntry } {
  return prompt.kind === "rename";
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
  initialPath,
  persistKey,
  onSelectionChange,
  onOpenFile,
  onDropPaths,
  onRowPointerDown,
  onOpenInTerminal,
}: { terminalId: string; home: string; sessionTitle: string | null } & PaneHooks) {
  const adapter = useMemo<PaneAdapter>(
    () => ({
      list: async (path: string) => (await listRemote(terminalId, path)).map(toPaneEntry),
      stream: async (path: string, onBatch: (entries: PaneEntry[]) => void) => {
        await listRemoteStream(terminalId, path, (batch) => onBatch(batch.map(toPaneEntry)));
        return 0;
      },

      home: async () => home,
      parent: parentPath,
    }),
    [terminalId, home],
  );
  const pane = useFilePane(adapter, initialPath, persistKey);

  const [menu, setMenu] = useState<{ x: number; y: number; entry: PaneEntry | null } | null>(null);
  const [prompt, setPrompt] = useState<RemotePrompt | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PaneEntry | null>(null);
  const [batchDelete, setBatchDelete] = useState<PaneEntry[] | null>(null);
  const [opError, setOpError] = useState<string | null>(null);
  const [transferPrompt, setTransferPrompt] = useState<{ entries: PaneEntry[]; mode: "copy" | "move" } | null>(null);
  const [copyPath, setCopyPath] = useState("");
  const [chmodTarget, setChmodTarget] = useState<PaneEntry | null>(null);
  const [chmodMode, setChmodMode] = useState(0o644);

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

  const run = useCallback(
    async (action: () => Promise<void>) => {
      try {
        setOpError(null);
        await action();
        await pane.refresh();
      } catch (err) {
        setOpError(toUserMessage(err));
      }
    },
    [pane],
  );

  /** Multi-selection wins over the row that was right-clicked. */
  function targetsFor(entry: PaneEntry): PaneEntry[] {
    const selected = pane.selectedEntries;
    return selected.some((item) => item.name === entry.name) && selected.length > 1
      ? selected
      : [entry];
  }

  function menuItems(entry: PaneEntry | null): FileMenuItem[] {
    if (entry === null) {
      return [
        { icon: "\uE8F4", label: "新建文件夹", onSelect: () => setPrompt({ kind: "folder" }) },
        { icon: "\uE8A5", label: "新建文件", onSelect: () => setPrompt({ kind: "file" }) },
        { icon: "\uE72C", label: "刷新", onSelect: () => void pane.refresh() },
        { icon: "\uE756", label: "在终端中打开", onSelect: () => onOpenInTerminal?.(pane.path) },
      ];
    }

    const targets = targetsFor(entry);
    if (targets.length > 1) {
      return [
        {
          icon: "\uE74D",
          label: `批量删除（${targets.length} 项）`,
          danger: true,
          onSelect: () => setBatchDelete(targets),
        },
        { icon: "\uE8C8", label: `批量复制到...`, onSelect: () => openTransfer(targets, "copy") },
        { icon: "\uE8DE", label: `批量移动到...`, onSelect: () => openTransfer(targets, "move") },
      ];
    }

    const common: FileMenuItem[] = [
      {
        icon: "\uE8C8",
        label: "复制到当前目录",
        onSelect: () => {
          void run(async () => {
            await copyRemote(terminalId, entry.path, joinPath(pane.path, `${entry.name} 副本`));
          });
        },
      },
      { icon: "\uE8C8", label: "复制到...", onSelect: () => openTransfer([entry], "copy") },
      { icon: "\uE8DE", label: "移动到...", onSelect: () => openTransfer([entry], "move") },
      {
        icon: "\uE72E",
        label: "权限",
        onSelect: () => {
          setChmodMode(entry.permissions ?? 0o644);
          setChmodTarget(entry);
        },
      },
    ];

    if (entry.isDir) {
      return [
        { icon: "\uE756", label: "在终端中打开", onSelect: () => onOpenInTerminal?.(entry.path) },
        { icon: "\uE8AC", label: "重命名", onSelect: () => setPrompt({ kind: "rename", entry }) },
        { icon: "\uE74D", label: "删除文件夹", danger: true, onSelect: () => setPendingDelete(entry) },
        ...common,
      ];
    }

    return [
      { icon: "\uE70F", label: "编辑", onSelect: () => onOpenFile?.(entry) },
      { icon: "\uE8AC", label: "重命名", onSelect: () => setPrompt({ kind: "rename", entry }) },
      { icon: "\uE74D", label: "删除", danger: true, onSelect: () => setPendingDelete(entry) },
      ...common,
    ];
  }

  function openTransfer(entries: PaneEntry[], mode: "copy" | "move") {
    const first = entries[0];
    setCopyPath(entries.length > 1 ? pane.path : joinPath(pane.path, `${first.name} 副本`));
    setTransferPrompt({ entries, mode });
  }

  /** Runs the pending copy/move for every target, then refreshes the pane. */
  async function submitTransfer() {
    const current = transferPrompt;
    const target = copyPath.trim();
    if (current === null || target.length === 0) {
      return;
    }
    setTransferPrompt(null);
    await run(async () => {
      for (const item of current.entries) {
        const destination =
          current.entries.length > 1 ? joinPath(target, item.name) : target;
        if (current.mode === "move") {
          await renameRemote(terminalId, item.path, destination);
        } else {
          await copyRemote(terminalId, item.path, destination);
        }
      }
      await pane.refresh();
    });
  }

  async function submitPrompt(value: string) {
    const current = prompt;
    setPrompt(null);
    if (current === null) {
      return;
    }
    if (current.kind === "folder") {
      await run(() => mkdirRemote(terminalId, joinPath(pane.path, value)));
    } else if (current.kind === "file") {
      await run(() => createRemoteFile(terminalId, joinPath(pane.path, value)));
    } else {
      await run(() => renameRemote(terminalId, current.entry.path, joinPath(pane.path, value)));
    }
  }

  const promptTitle =
    prompt === null
      ? ""
      : prompt.kind === "folder"
        ? "新建远程文件夹"
        : prompt.kind === "file"
          ? "新建远程文件"
          : "重命名远程项目";

  const errorText = opError ?? pane.error;

  return (
    <section
      className={`fm-pane${dropActive === true ? " fm-pane--drop" : ""}`}
      data-drop-remote="true"
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
        search={pane.filter}
        onSearch={pane.setFilter}
        onNavigate={(next) => void pane.load(next)}
        onUp={() => void pane.goUp()}
        onRefresh={() => void pane.refresh()}
      />
      <FileTable
        onSelectAll={pane.selectAll}
        persistKey={persistKey}
        entries={pane.visible}
        selected={pane.selected}
        showPermissions
        loading={pane.loading}
        sort={pane.sort}
        onSort={pane.toggleSort}
        onSelect={pane.select}
        onOpen={(entry) => {
          if (entry.isDir) {
            void pane.load(entry.path);
          } else {
            onOpenFile?.(entry);
          }
        }}
        onContextMenu={(entry, event) => setMenu({ x: event.clientX, y: event.clientY, entry })}
        onRowPointerDown={onRowPointerDown}
      />
      {errorText !== null && (
        <button
          type="button"
          className="fm-error"
          onClick={() => {
            setOpError(null);
            pane.clearError();
          }}
        >
          {errorText}（点击关闭）
        </button>
      )}
      <footer className="fm-pane__foot">
        <span>{pane.visible.length} 项</span>
        {pane.selected.length > 0 && <span>已选 {pane.selected.length}</span>}
        <span className="fm-pane__foot-end">{sessionTitle ?? ""}</span>
      </footer>

      {menu !== null && (
        <FileContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems(menu.entry)}
          onClose={() => setMenu(null)}
        />
      )}

      {transferPrompt !== null && (
        <div className="modal-backdrop" role="presentation">
          <div className="modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <h2 className="modal__title">
              {transferPrompt.mode === "move" ? "移动到" : "复制到"}
              {transferPrompt.entries.length > 1 ? `（${transferPrompt.entries.length} 项）` : ""}
            </h2>
            <p className="modal__hint">
              {transferPrompt.entries.length > 1 ? "目标远程目录" : "目标远程路径（含文件名）"}
            </p>
            <input
              autoFocus
              className="input"
              value={copyPath}
              onChange={(event) => setCopyPath(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void submitTransfer();
                }
              }}
            />
            <div className="modal__actions">
              <button type="button" className="button button--primary" onClick={() => void submitTransfer()}>
                确定
              </button>
              <button type="button" className="button button--ghost" onClick={() => setTransferPrompt(null)}>
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {batchDelete !== null && (
        <div className="modal-backdrop" role="presentation">
          <div className="modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <h2 className="modal__title">批量删除</h2>
            <p className="modal__body">
              确定删除选中的 {batchDelete.length} 项吗？目录会被递归删除，且不可恢复。
            </p>
            <div className="modal__actions">
              <button
                type="button"
                className="button button--danger"
                onClick={() => {
                  const targets = batchDelete;
                  setBatchDelete(null);
                  void run(async () => {
                    for (const item of targets) {
                      await removeRemote(terminalId, item.path, item.isDir);
                    }
                    await pane.refresh();
                  });
                }}
              >
                删除
              </button>
              <button type="button" className="button button--ghost" onClick={() => setBatchDelete(null)}>
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {chmodTarget !== null && (
        <div className="modal-backdrop" role="presentation">
          <div className="modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <h2 className="modal__title">权限设置 · {chmodTarget.name}</h2>
            <p className="modal__hint">
              「你」= 文件创建者；「同组用户」= 与创建者同一用户组的账号；「其他所有人」= 其余任何账号。
              <br />
              r：读取内容 / 列出目录　w：修改内容 / 新建或删除文件　x：执行程序 / 进入目录
            </p>
            {(["你（创建者）", "同组用户", "其他所有人"] as const).map((label, row) => (
              <div className="chmod-row" key={label}>
                <span className="chmod-row__label">{label}</span>
                {[0, 1, 2].map((bit) => {
                  const shift = (2 - row) * 3 + (2 - bit);
                  const flag = (chmodMode & (1 << shift)) !== 0;
                  return (
                    <label className="chmod-row__item" key={shift}>
                      <input
                        type="checkbox"
                        checked={flag}
                        onChange={() =>
                          setChmodMode((previous) =>
                            flag ? previous & ~(1 << shift) : previous | (1 << shift),
                          )
                        }
                      />
                      {["r", "w", "x"][bit]}
                    </label>
                  );
                })}
              </div>
            ))}
            <p className="modal__hint">
              当前权限：<code>{chmodMode.toString(8).padStart(3, "0")}</code>
            </p>
            <div className="modal__actions">
              <button
                type="button"
                className="button button--primary"
                onClick={() => {
                  if (chmodTarget === null) {
                    return;
                  }
                  const target = chmodTarget;
                  setChmodTarget(null);
                  void run(() => chmodRemote(terminalId, target.path, chmodMode));
                }}
              >
                保存
              </button>
              <button type="button" className="button button--ghost" onClick={() => setChmodTarget(null)}>
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {prompt !== null && (
        <PromptDialog
          title={promptTitle}
          initial={isRenamePrompt(prompt) ? prompt.entry.name : ""}
          placeholder={prompt.kind === "folder" ? "文件夹名称" : "文件名"}
          confirmLabel={prompt.kind === "rename" ? "重命名" : "创建"}
          onConfirm={(value) => void submitPrompt(value)}
          onCancel={() => setPrompt(null)}
        />
      )}

      {pendingDelete !== null && (
        <ConfirmDialog
          title="删除远程项目"
          message={`确定删除「${pendingDelete.name}」吗？${pendingDelete.isDir ? "文件夹会被递归删除（包含其中的所有文件和子目录），且不可恢复。" : "删除后不可恢复。"}`}
          confirmLabel="删除"
          onConfirm={() => {
            const target = pendingDelete;
            setPendingDelete(null);
            void run(() => removeRemote(terminalId, target.path, target.isDir));
          }}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </section>
  );
}
