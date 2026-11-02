import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { FileEntry } from "../../lib/fs/types";
import { toUserMessage } from "../../lib/ipc/errors";

export type SelectionMode = "single" | "toggle" | "range";

export interface PaneAdapter {
  list(path: string): Promise<FileEntry[]>;
  home(): Promise<string>;
  parent(path: string): string;
  /** Optional background metadata hydration (local pane). */
  enrich?(
    entries: FileEntry[],
    onPatch: (path: string, patch: Partial<FileEntry>) => void,
  ): Promise<void>;
}

export interface FilePaneState {
  path: string;
  entries: FileEntry[];
  selected: string[];
  selectedEntries: FileEntry[];
  loading: boolean;
  error: string | null;
  load: (path: string) => Promise<void>;
  refresh: () => Promise<void>;
  goUp: () => Promise<void>;
  select: (name: string, mode: SelectionMode) => void;
  clearError: () => void;
}

/** One instance per pane: the two panes never share path/selection state. */
export function useFilePane(adapter: PaneAdapter, initialPath?: string): FilePaneState {
  const [path, setPath] = useState("");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const anchorRef = useRef<string | null>(null);
  const requestRef = useRef(0);

  const load = useCallback(
    async (target: string) => {
      const request = ++requestRef.current;
      setLoading(true);
      setError(null);
      try {
        const list = await adapter.list(target);
        if (request !== requestRef.current) {
          return;
        }
        setPath(target);
        setEntries(list);
        setSelected([]);
        anchorRef.current = null;
        if (adapter.enrich) {
          void adapter.enrich(list, (entryPath, patch) => {
            setEntries((previous) =>
              previous.map((entry) =>
                entry.path === entryPath ? { ...entry, ...patch } : entry,
              ),
            );
          });
        }
      } catch (err) {
        if (request === requestRef.current) {
          setError(toUserMessage(err));
        }
      } finally {
        if (request === requestRef.current) {
          setLoading(false);
        }
      }
    },
    [adapter],
  );

  useEffect(() => {
    let cancelled = false;
    const start = initialPath !== undefined && initialPath.length > 0
      ? Promise.resolve(initialPath)
      : adapter.home();
    start
      .then((home) => {
        if (!cancelled) {
          return load(home);
        }
        return undefined;
      })
      .catch((err) => {
        if (!cancelled) {
          setError(toUserMessage(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [adapter, load, initialPath]);

  const select = useCallback(
    (name: string, mode: SelectionMode) => {
      if (mode === "single") {
        anchorRef.current = name;
        setSelected([name]);
        return;
      }
      if (mode === "toggle") {
        anchorRef.current = name;
        setSelected((previous) =>
          previous.includes(name)
            ? previous.filter((item) => item !== name)
            : [...previous, name],
        );
        return;
      }
      const anchor = anchorRef.current ?? name;
      const names = entries.map((entry) => entry.name);
      const from = names.indexOf(anchor);
      const to = names.indexOf(name);
      if (from < 0 || to < 0) {
        setSelected([name]);
        return;
      }
      const [start, end] = from <= to ? [from, to] : [to, from];
      setSelected(names.slice(start, end + 1));
    },
    [entries],
  );

  const refresh = useCallback(async () => {
    if (path) {
      await load(path);
    }
  }, [path, load]);

  const goUp = useCallback(async () => {
    if (path) {
      await load(adapter.parent(path));
    }
  }, [adapter, path, load]);

  const selectedEntries = useMemo(
    () => entries.filter((entry) => selected.includes(entry.name)),
    [entries, selected],
  );

  return {
    path,
    entries,
    selected,
    selectedEntries,
    loading,
    error,
    load,
    refresh,
    goUp,
    select,
    clearError: () => setError(null),
  };
}
