import { useEffect, useRef, useState } from "react";

import type { FileEntry } from "../../lib/fs/types";
import type { SelectionMode, SortKey, SortState } from "./useFilePane";
import { formatMode, formatSize, formatTime } from "./format";

interface FileTableProps {
  entries: FileEntry[];
  selected: string[];
  showPermissions?: boolean;
  loading: boolean;
  /** Enables remembering the scroll offset for this pane. */
  persistKey?: string;
  sort: SortState;
  onSort: (key: SortKey) => void;
  onSelect: (name: string, mode: SelectionMode) => void;
  onOpen: (entry: FileEntry) => void;
  /** `entry === null` means the empty area below the rows. */
  onContextMenu: (entry: FileEntry | null, event: React.MouseEvent) => void;
  onRowPointerDown?: (entry: FileEntry, event: React.PointerEvent) => void;
}

const ROW_HEIGHT = 26;

const SORT_LABEL: Record<SortKey, string> = {
  name: "名称",
  size: "大小",
  mtime: "修改时间",
  type: "类型",
};

export function FileTable({
  entries,
  selected,
  showPermissions = false,
  loading,
  sort,
  onSort,
  onSelect,
  onOpen,
  onContextMenu,
  onRowPointerDown,
  persistKey,}: FileTableProps) {
  const arrow = (key: SortKey) => (sort.key === key ? (sort.dir === 1 ? " ▲" : " ▼") : "");

  // Windowing keeps 8000-entry folders responsive: only the visible rows are
  // mounted, positioned inside a spacer that reserves the full scroll height.
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(480);
  const scrollKey = persistKey !== undefined ? persistKey + ":scroll" : undefined;
  const restoreScroll = useRef(false);

  useEffect(() => {
    const element = bodyRef.current;
    if (element === null || scrollKey === undefined || entries.length === 0) {
      return;
    }
    // Restore once the rows exist (the spacer needs its height first).
    const raw = localStorage.getItem(scrollKey);
    const top = raw === null ? 0 : Number.parseInt(raw, 10);
    if (Number.isFinite(top) && top > 0) {
      element.scrollTop = top;
      setScrollTop(top);
    }
    restoreScroll.current = true;
  }, [scrollKey, entries.length]);

  useEffect(() => {
    if (scrollKey !== undefined && restoreScroll.current) {
      localStorage.setItem(scrollKey, String(scrollTop));
    }
  }, [scrollKey, scrollTop]);

  useEffect(() => {
    const element = bodyRef.current;
    if (element === null || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(() => setViewportHeight(element.clientHeight));
    observer.observe(element);
    setViewportHeight(element.clientHeight);
    return () => observer.disconnect();
  }, []);

  const firstRow = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 6);
  const rowCount = Math.ceil(viewportHeight / ROW_HEIGHT) + 14;
  const windowed = entries.slice(firstRow, firstRow + rowCount);

  const head = (key: SortKey, label: string) => (
    <button
      type="button"
      className={`fm-table__sort${sort.key === key ? " fm-table__sort--active" : ""}`}
      onClick={() => onSort(key)}
      title={`按${SORT_LABEL[key]}排序`}
    >
      {label}
      {arrow(key)}
    </button>
  );

  return (
    <div className="fm-table" role="grid">
      <div className={`fm-table__head${showPermissions ? " fm-table__head--perm" : ""}`}>
        {head("name", "名称")}
        {head("size", "大小")}
        {showPermissions && head("type", "权限")}
        {head("mtime", "修改时间")}
      </div>
      {loading && <div className="fm-table__loadingbar" aria-hidden="true" />}
      <div
        className="fm-table__body"
        ref={bodyRef}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        onContextMenu={(event) => {
          // Only fires when the click was not on a row (rows stop propagation).
          event.preventDefault();
          onContextMenu(null, event);
        }}
      >
        {entries.length === 0 && (
          <div className="fm-table__empty">{loading ? "加载中…" : "空目录（右键可新建）"}</div>
        )}
        <div className="fm-table__spacer" style={{ height: entries.length * ROW_HEIGHT }}>
        {windowed.map((entry, index) => (
          <div
            key={entry.path}
            role="row"
            aria-selected={selected.includes(entry.name)}
            style={{ position: "absolute", top: (firstRow + index) * ROW_HEIGHT, left: 0, right: 0 }}
            className={`fm-row${selected.includes(entry.name) ? " fm-row--selected" : ""}${
              showPermissions ? " fm-row--perm" : ""
            }`}
            onClick={(event) =>
              onSelect(
                entry.name,
                event.ctrlKey || event.metaKey ? "toggle" : event.shiftKey ? "range" : "single",
              )
            }
            onDoubleClick={() => onOpen(entry)}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onSelect(entry.name, "single");
              onContextMenu(entry, event);
            }}
            onPointerDown={(event) => onRowPointerDown?.(entry, event)}
            title={entry.path}
          >
            <span className={`fm-row__name${entry.isDir ? " fm-row__name--dir" : ""}`}>
              <span className="fm-row__icon">{entry.isDir ? "📁" : entry.isSymlink ? "🔗" : "📄"}</span>
              {entry.name}
            </span>
            <span className="fm-row__size">{entry.isDir ? "" : formatSize(entry.size)}</span>
            {showPermissions && <span className="fm-row__mode">{formatMode(entry.permissions)}</span>}
            <span className="fm-row__time">{formatTime(entry.mtimeMs)}</span>
          </div>
        ))}
        </div>
      </div>
    </div>
  );
}
