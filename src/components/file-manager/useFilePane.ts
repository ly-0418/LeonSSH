import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { FileEntry } from "../../lib/fs/types";
import { toUserMessage } from "../../lib/ipc/errors";

export type SelectionMode = "single" | "toggle" | "range";
export type SortKey = "name" | "size" | "mtime" | "type";

export interface SortState {
  key: SortKey;
  dir: 1 | -1;
}

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
  visible: FileEntry[];
  selected: string[];
  selectedEntries: FileEntry[];
  loading: boolean;
  error: string | null;
  filter: string;
  sort: SortState;
  setFilter: (value: string) => void;
  toggleSort: (key: SortKey) => void;
  load: (path: string) => Promise<void>;
  refresh: () => Promise<void>;
  goUp: () => Promise<void>;
  select: (name: string, mode: SelectionMode) => void;
  clearError: () => void;
}

/** Hidden entries (dotfiles plus the usual Windows system folders). */
const HIDDEN_NAMES = new Set([
  // Windows marks these Hidden+System, but readDir does not expose attributes,
  // so they are filtered by name (case-insensitive).
  "$recycle.bin",
  "system volume information",
  "recycler",
  "$winreagent",
  "$sysreset",
  "config.msi",
  "desktop.ini",
  "thumbs.db",
  "pagefile.sys",
  "hiberfil.sys",
  "swapfile.sys",
  "dumpstack.log.tmp",
]);

export function isHiddenEntry(entry: FileEntry): boolean {
  return entry.name.startsWith(".") || HIDDEN_NAMES.has(entry.name.toLowerCase());
}

function compare(a: FileEntry, b: FileEntry, sort: SortState): number {
  const dir = sort.dir;
  switch (sort.key) {
    case "size":
      return ((a.size ?? -1) - (b.size ?? -1)) * dir;
    case "mtime":
      return ((a.mtimeMs ?? 0) - (b.mtimeMs ?? 0)) * dir;
    case "type":
      if (a.isDir !== b.isDir) {
        return (a.isDir ? -1 : 1) * dir;
      }
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }) * dir;
    default:
      if (a.isDir !== b.isDir) {
        return a.isDir ? -1 : 1;
      }
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }) * dir;
  }
}

/** One instance per pane: the two panes never share path/selection state. */
export function useFilePane(adapter: PaneAdapter, initialPath?: string): FilePaneState {
  const [path, setPath] = useState("");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<SortState>({ key: "name", dir: 1 });
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
        setFilter("");
        anchorRef.current = null;
        if (adapter.enrich) {
          // Defer metadata hydration until the listing has painted, then apply
          // results in batches: one state update per ~200ms instead of one per
          // file (which used to map the whole folder array hundreds of times).
          window.setTimeout(() => {
            if (request !== requestRef.current) {
              return;
            }
            const pending = new Map<string, Partial<FileEntry>>();
            let scheduled = false;

            const flush = () => {
              scheduled = false;
              if (request !== requestRef.current || pending.size === 0) {
                return;
              }
              const patches = new Map(pending);
              pending.clear();
              setEntries((previous) =>
                previous.map((entry) => {
                  const patch = patches.get(entry.path);
                  return patch === undefined ? entry : { ...entry, ...patch };
                }),
              );
            };

            void adapter.enrich?.(list, (entryPath, patch) => {
              if (request !== requestRef.current) {
                return;
              }
              pending.set(entryPath, patch);
              if (!scheduled) {
                scheduled = true;
                window.setTimeout(flush, 200);
              }
            });
          }, 0);
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
      const names = visibleNames(entries, filter, sort);
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
      const from = names.indexOf(anchor);
      const to = names.indexOf(name);
      if (from < 0 || to < 0) {
        setSelected([name]);
        return;
      }
      const [start, end] = from <= to ? [from, to] : [to, from];
      setSelected(names.slice(start, end + 1));
    },
    [entries, filter, sort],
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

  const visible = useMemo(() => {
    const query = filter.trim().toLowerCase();
    const list = entries
      .filter((entry) => !isHiddenEntry(entry))
      .filter((entry) => query === "" || entry.name.toLowerCase().includes(query));
    return [...list].sort((a, b) => compare(a, b, sort));
  }, [entries, filter, sort]);

  const visibleNamesSet = useMemo(() => new Set(visible.map((entry) => entry.name)), [visible]);
  const selectedEntries = useMemo(
    () => visible.filter((entry) => selected.includes(entry.name)),
    [visible, selected],
  );

  const toggleSort = useCallback((key: SortKey) => {
    setSort((previous) =>
      previous.key === key
        ? { key, dir: previous.dir === 1 ? -1 : 1 }
        : { key, dir: 1 },
    );
  }, []);

  return {
    path,
    entries,
    visible,
    selected: selected.filter((name) => visibleNamesSet.has(name)),
    selectedEntries,
    loading,
    error,
    filter,
    sort,
    setFilter,
    toggleSort,
    load,
    refresh,
    goUp,
    select,
    clearError: () => setError(null),
  };
}

function visibleNames(entries: FileEntry[], filter: string, sort: SortState): string[] {
  const query = filter.trim().toLowerCase();
  return entries
    .filter((entry) => !isHiddenEntry(entry))
    .filter((entry) => query === "" || entry.name.toLowerCase().includes(query))
    .sort((a, b) => compare(a, b, sort))
    .map((entry) => entry.name);
}
