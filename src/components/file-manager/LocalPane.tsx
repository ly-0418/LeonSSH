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
  onSelectionChange,
  onRowPointerDown,
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
  const [roots, setRoots] = useState<string[]>([]);
  const [desktop, setDesktop] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; entry: FileEntry | null } | null>(null);
  const [prompt, setPrompt] = useState<PromptState | null>(null);
  const [pendingDelete, setPendingDelete] = useState<FileEntry | null>(null);
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
    if (entry === null) {
      return [
        { label: "新建文件夹", onSelect: () => setPrompt({ kind: "folder" }) },
        { label: "新建文件", onSelect: () => setPrompt({ kind: "file" }) },
      ];
    }
    if (entry.isDir) {
      return [
        { label: "重命名", onSelect: () => setPrompt({ kind: "rename", entry }) },
        { label: "删除文件夹", danger: true, onSelect: () => setPendingDelete(entry) },
      ];
    }
    return [
      { label: "编辑（系统默认工具）", onSelect: () => void run(() => openLocalFile(entry.path)) },
      { label: "重命名", onSelect: () => setPrompt({ kind: "rename", entry }) },
      { label: "删除", danger: true, onSelect: () => setPendingDelete(entry) },
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
    <section className="fm-pane">
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
persistKey={persistKey}         entries={pane.visible}
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
    </section>
  );
}
