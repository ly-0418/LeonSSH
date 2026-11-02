import { useEffect, useMemo, useState } from "react";

import { hydrateLocalStats, listLocal, localHome, localRoots } from "../../lib/fs/localFs";
import { parentLocal } from "../../lib/fs/paths";
import { FileTable } from "./FileTable";
import { PathBar } from "./PathBar";
import { useFilePane, type PaneAdapter } from "./useFilePane";

/** Left pane: the local filesystem, exclusively through @tauri-apps/plugin-fs. */
export function LocalPane({ initialPath }: { initialPath?: string }) {
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
        onSelect={pane.select}
        onOpen={(entry) => {
          if (entry.isDir) {
            void pane.load(entry.path);
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
      </footer>
    </section>
  );
}
