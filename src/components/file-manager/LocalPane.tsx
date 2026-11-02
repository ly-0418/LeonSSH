import { useEffect, useMemo, useRef, useState } from "react";

import type { FileEntry } from "../../lib/fs/types";
import { hydrateLocalStats, listLocal, localHome, localRoots } from "../../lib/fs/localFs";
import { parentLocal } from "../../lib/fs/paths";
import { FileTable } from "./FileTable";
import { PathBar } from "./PathBar";
import { useFilePane, type PaneAdapter } from "./useFilePane";

interface LocalPaneProps {
  initialPath?: string;
  refreshToken?: number;
  onPathChange?: (path: string) => void;
  onSelectionChange?: (entries: FileEntry[]) => void;
  onOpenFile?: (entry: FileEntry) => void;
}

/** Left pane: the local filesystem, exclusively through @tauri-apps/plugin-fs. */
export function LocalPane({
  initialPath,
  refreshToken,
  onPathChange,
  onSelectionChange,
  onOpenFile,
}: LocalPaneProps) {
  const adapter = useMemo<PaneAdapter>(
    () => ({
      list: listLocal,
      home: localHome,
      parent: parentLocal,
      enrich: hydrateLocalStats,
    }),
    [],
  );
  const pane = useFilePane(adapter, initialPath);
  const [roots, setRoots] = useState<string[]>([]);

  useEffect(() => {
    localRoots()
      .then(setRoots)
      .catch(() => setRoots([]));
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

  return (
    <section className="fm-pane">
      <PathBar
        label="本地"
        path={pane.path}
        loading={pane.loading}
        roots={roots}
        onNavigate={(next) => void pane.load(next)}
        onUp={() => void pane.goUp()}
        onRefresh={() => void pane.refresh()}
      />
      <FileTable
        entries={pane.entries}
        selected={pane.selected}
        loading={pane.loading}
        draggable
        onSelect={pane.select}
        onOpen={(entry) => {
          if (entry.isDir) {
            void pane.load(entry.path);
          } else {
            onOpenFile?.(entry);
          }
        }}
      />
      {pane.error !== null && (
        <button type="button" className="fm-error" onClick={pane.clearError}>
          {pane.error}（点击关闭）
        </button>
      )}
      <footer className="fm-pane__foot">
        <span>{pane.entries.length} 项</span>
        {pane.selected.length > 0 && <span>已选 {pane.selected.length}</span>}
        <span className="fm-pane__foot-end">拖到右侧可上传</span>
      </footer>
    </section>
  );
}
