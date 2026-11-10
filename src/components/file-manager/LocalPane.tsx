import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { FileEntry } from "../../lib/fs/types";
import {
  createLocalDir,
  createLocalFile,
  deleteLocal,
  hydrateLocalStats,
  listLocal,
  localDesktop,
  localRoots,
  openLocalFile,
  renameLocal,
} from "../../lib/fs/localFs";
import { joinLocal, parentLocal } from "../../lib/fs/paths";
import { toUserMessage } from "../../lib/ipc/errors";
import { ConfirmDialog } from "../dialogs";
import { FileContextMenu, type FileMenuItem } from "./FileContextMenu";
import { FileTable } from "./FileTable";
import { PathBar } from "./PathBar";
import { PromptDialog } from "./PromptDialog";
import { useFilePane, type PaneAdapter } from "./useFilePane";

interface LocalPaneProps {
  initialPath?: string;
  refreshToken?: number;
  onPathChange?: (path: string) => void;
  persistKey?: string;
  /** Highlight while a remote drag hovers this pane. */
  dropActive?: boolean;
  /** Files dragged from the remote pane: download them here. */
  onRemoteDrop?: (entries: FileEntry[]) => void;
  onSelectionChange?: (entries: FileEntry[]) => void;
  onRowPointerDown?: (entry: FileEntry, event: React.PointerEvent) => void;
}

type PromptState =
  | { kind: "folder" }
  | { kind: "file" }
  | { kind: "rename"; entry: FileEntry };

function isRename(prompt: PromptState): prompt is { kind: "rename"; entry: FileEntry } {
  return prompt.kind === "rename";
}

/** Left pane: the local filesystem, exclusively through @tauri-apps/plugin-fs. */
export function LocalPane({
  initialPath,
  refreshToken,
  onPathChange,
  persistKey,
  onRemoteDrop,
  onSelectionChange,
  onRowPointerDown,
  dropActive,
}: LocalPaneProps) {
  const adapter = useMemo<PaneAdapter>(
    () => ({
      list: listLocal,
      home: localDesktop,
      parent: parentLocal,
      enrich: hydrateLocalStats,
    }),
    [],
  );
  const pane = useFilePane(adapter, initialPath, persistKey);

  // Picking the window back up (e.g. after creating a folder in Explorer)
  // should re-read the directory, otherwise the pane shows a stale listing.
  useEffect(() => {
    const onFocus = () => {
      if (pane.path !== "") {
        void pane.load(pane.path);
      }
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [pane.path, pane.load]);

  // Picking the window back up \(e\.g\. after creating a folder in Explorer\)\n  // should re-read the directory, otherwise the pane shows a stale listing\.\n  useEffect\(\(\) => \{\n    const onFocus = \(\) => \{\n      if \(pane\.path !== ""\) \{\n        void pane\.load\(pane\.path\);\n      }\n    };\n    window\.addEventListener\("focus", onFocus\);\n    return \(\) => window\.removeEventListener\("focus", onFocus\);\n  }, \[pane\.path, pane\.load]\);\n
  const [roots, setRoots] = useState<string[]>([]);
  const [desktop, setDesktop] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; entry: FileEntry | null } | null>(null);
  const [prompt, setPrompt] = useState<PromptState | null>(null);
  const [pendingDelete, setPendingDelete] = useState<FileEntry | null>(null);
  const [batchDelete, setBatchDelete] = useState<FileEntry[] | null>(null);
  const [batchProgress, setBatchProgress] = useState<{ total: number; done: number; current: string } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    localRoots()
      .then(setRoots)
      .catch(() => setRoots([]));
    localDesktop()
      .then(setDesktop)
      .catch(() => setDesktop(null));
  }, []);

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
        setError(null);
        await action();
        await pane.refresh();
      } catch (err) {
        setError(toUserMessage(err));
      }
    },
    [pane],
  );

  function menuItems(entry: FileEntry | null): FileMenuItem[] {
    if (entry !== null) {
      // Multi-selection wins over the single row that was right-clicked.
      const selected = pane.selectedEntries;
      const targets =
        selected.some((item) => item.name === entry.name) && selected.length > 1
          ? selected
          : [entry];
      if (targets.length > 1) {
        return [
          {
            icon: "\uE74D",
            label: `批量删除（${targets.length} 项）`,
            danger: true,
            onSelect: () => setBatchDelete(targets),
          },
        ];
      }
    }
    if (entry === null) {
      return [
        { icon: "\uE8F4", label: "新建文件夹", onSelect: () => setPrompt({ kind: "folder" }) },
        { icon: "\uE8A5", label: "新建文件", onSelect: () => setPrompt({ kind: "file" }) },
        { icon: "\uE72C", label: "刷新", onSelect: () => void pane.refresh() },
      ];
    }
    if (entry.isDir) {
      return [
        { icon: "\uE8AC", label: "重命名", onSelect: () => setPrompt({ kind: "rename", entry }) },
        { icon: "\uE74D", label: "删除文件夹", danger: true, onSelect: () => setPendingDelete(entry) },
      ];
    }
    return [
      { icon: "\uE70F", label: "编辑（系统默认工具）", onSelect: () => void run(() => openLocalFile(entry.path)) },
      { icon: "\uE8AC", label: "重命名", onSelect: () => setPrompt({ kind: "rename", entry }) },
      { icon: "\uE74D", label: "删除", danger: true, onSelect: () => setPendingDelete(entry) },
    ];
  }

  async function submitPrompt(value: string) {
    const current = prompt;
    setPrompt(null);
    if (current === null) {
      return;
    }
    if (current.kind === "folder") {
      await run(() => createLocalDir(joinLocal(pane.path, value)));
    } else if (current.kind === "file") {
      await run(() => createLocalFile(joinLocal(pane.path, value)));
    } else {
      await run(() => renameLocal(current.entry.path, joinLocal(pane.path, value)));
    }
  }

  const promptTitle =
    prompt === null
      ? ""
      : prompt.kind === "folder"
        ? "新建文件夹"
        : prompt.kind === "file"
          ? "新建文件"
          : "重命名";

  return (
    <section className={`fm-pane${dropActive === true ? " fm-pane--drop" : ""}`} data-drop-local="true">
      <PathBar
        label="本地"
        path={pane.path}
        loading={pane.loading}
        roots={roots}
        desktop={desktop ?? undefined}
        search={pane.filter}
        onSearch={pane.setFilter}
        onNavigate={(next) => void pane.load(next)}
        onUp={() => void pane.goUp()}
        onRefresh={() => void pane.refresh()}
      />
      <FileTable
onSelectAll={pane.selectAll} 
persistKey={persistKey} onDropEntries={onRemoteDrop}
                  entries={pane.visible}
        selected={pane.selected}
        loading={pane.loading}
        sort={pane.sort}
        onSort={pane.toggleSort}
        onSelect={pane.select}
        onOpen={(entry) => {
          if (entry.isDir) {
            void pane.load(entry.path);
          } else {
            void run(() => openLocalFile(entry.path));
          }
        }}
        onContextMenu={(entry, event) => setMenu({ x: event.clientX, y: event.clientY, entry })}
        onRowPointerDown={onRowPointerDown}
      />
      {(error ?? pane.error) !== null && (
        <button
          type="button"
          className="fm-error"
          onClick={() => {
            setError(null);
            pane.clearError();
          }}
        >
          {error ?? pane.error}（点击关闭）
        </button>
      )}
      <footer className="fm-pane__foot">
        <span>{pane.visible.length} 项</span>
        {pane.selected.length > 0 && <span>已选 {pane.selected.length}</span>}
        <span className="fm-pane__foot-end">拖到右侧可上传</span>
      </footer>

      {menu !== null && (
        <FileContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems(menu.entry)}
          onClose={() => setMenu(null)}
        />
      )}

      {prompt !== null && (
        <PromptDialog
          title={promptTitle}
          initial={isRename(prompt) ? prompt.entry.name : ""}
          placeholder={prompt.kind === "folder" ? "文件夹名称" : "文件名"}
          confirmLabel={prompt.kind === "rename" ? "重命名" : "创建"}
          onConfirm={(value) => void submitPrompt(value)}
          onCancel={() => setPrompt(null)}
        />
      )}

      {pendingDelete !== null && (
        <ConfirmDialog
          title="删除本地项目"
          message={`确定删除「${pendingDelete.name}」吗？${pendingDelete.isDir ? "文件夹及其内容会被删除。" : ""}`}
          confirmLabel="删除"
          onConfirm={() => {
            const target = pendingDelete;
            setPendingDelete(null);
            void run(() => deleteLocal(target.path, target.isDir));
          }}
          onCancel={() => setPendingDelete(null)}
        />
      )}
      {batchDelete !== null && (
        <ConfirmDialog
          title="批量删除"
          message={`确定删除选中的 ${batchDelete.length} 项吗？文件夹会被递归删除，且不可恢复。`}
          confirmLabel="删除"
          onConfirm={() => {
            const targets = batchDelete;
            setBatchDelete(null);
            void (async () => {
              setError(null);
              setBatchProgress({ total: targets.length, done: 0, current: targets[0]?.name ?? "" });
              try {
                for (let index = 0; index < targets.length; index += 1) {
                  const item = targets[index];
                  setBatchProgress({ total: targets.length, done: index, current: item.name });
                  await deleteLocal(item.path, item.isDir);
                  setBatchProgress({ total: targets.length, done: index + 1, current: item.name });
                }
                await pane.refresh();
              } catch (err) {
                setError(toUserMessage(err));
                await pane.refresh().catch(() => undefined);
              } finally {
                setBatchProgress(null);
              }
            })();
          }}
          onCancel={() => setBatchDelete(null)}
        />
      )}

      {batchProgress !== null && (
        <div className="modal-backdrop" role="presentation">
          <div className="modal" role="dialog" aria-modal="true" aria-live="polite">
            <h2 className="modal__title">
              <span className="fm-progress__spinner" aria-hidden="true" />
              {"  "}正在删除文件
            </h2>
            <div className="fm-progress">
              <div className="fm-progress__row">
                <span>
                  已完成 <strong>{batchProgress.done}</strong> / {batchProgress.total}
                </span>
                <span>{Math.round((batchProgress.done / Math.max(1, batchProgress.total)) * 100)}%</span>
              </div>
              <div className="fm-progress__track">
                <div
                  className="fm-progress__fill"
                  style={{
                    width: `${Math.round((batchProgress.done / Math.max(1, batchProgress.total)) * 100)}%`,
                  }}
                />
              </div>
              <div className="fm-progress__current" title={batchProgress.current}>
                正在处理：{batchProgress.current}
              </div>
              <p className="modal__hint">文件夹会递归删除，删除期间请不要关闭窗口。</p>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
