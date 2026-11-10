import { memGet, memSet } from "../../lib/fs/fmMemory";
import { useEffect, useRef, useState , useMemo} from "react";

import { ShellFileIcon } from "./ShellFileIcon";
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
  /** Replaces the whole selection (header checkbox). */
  onSelectAll?: (names: string[]) => void;
  onOpen: (entry: FileEntry) => void;
  /** `entry === null` means the empty area below the rows. */
  onContextMenu: (entry: FileEntry | null, event: React.MouseEvent) => void;
  onRowPointerDown?: (entry: FileEntry, event: React.PointerEvent, selection: FileEntry[]) => void;
  /** Enables HTML5 dragging of rows (remote → local download). */
  onRowDragStart?: (entry: FileEntry, event: React.DragEvent) => void;
  /** Accepts files dropped onto the table body (remote → local download). */
  onDropEntries?: (entries: FileEntry[]) => void;
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
  onSelectAll,
  onOpen,
  onContextMenu,
  onRowPointerDown,
  persistKey,
  onRowDragStart,
  onDropEntries,}: FileTableProps) {
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
    const raw = memGet(scrollKey);
    const top = raw === null ? 0 : Number.parseInt(raw, 10);
    if (Number.isFinite(top) && top > 0) {
      element.scrollTop = top;
      setScrollTop(top);
    }
    restoreScroll.current = true;
  }, [scrollKey, entries.length]);

  useEffect(() => {
    if (scrollKey !== undefined && restoreScroll.current) {
      memSet(scrollKey, String(scrollTop));
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

  // Rubber-band selection (Windows Explorer style): dragging on the empty area
  // paints a rectangle and selects every row it touches.
  const [band, setBand] = useState<{ left: number; top: number; width: number; height: number } | null>(
    null,
  );
  const bandStart = useRef<{ x: number; y: number; additive: boolean } | null>(null);
  const bandFrame = useRef(0);

  const bandNames = (rect: { left: number; top: number; width: number; height: number }): string[] => {
    const first = Math.max(0, Math.floor(rect.top / ROW_HEIGHT));
    const last = Math.min(entries.length - 1, Math.floor((rect.top + rect.height) / ROW_HEIGHT));
    if (last < first) {
      return [];
    }
    return entries.slice(first, last + 1).map((entry) => entry.name);
  };

  const applyBand = (rect: { left: number; top: number; width: number; height: number }) => {
    const names = bandNames(rect);
    if (onSelectAll === undefined) {
      for (const name of names) {
        onSelect(name, "toggle");
      }
      return;
    }
    if (bandStart.current?.additive === true) {
      const merged = new Set(selected);
      for (const name of names) {
        merged.add(name);
      }
      onSelectAll([...merged]);
    } else {
      onSelectAll(names);
    }
  };

  const updateBand = (clientX: number, clientY: number) => {
    const body = bodyRef.current;
    const start = bandStart.current;
    if (body === null || start === null) {
      return;
    }
    const box = body.getBoundingClientRect();
    const x = clientX - box.left;
    const y = clientY - box.top + body.scrollTop;
    const left = Math.min(start.x, x);
    const top = Math.min(start.y, y);
    const rect = {
      left,
      top,
      width: Math.abs(x - start.x),
      height: Math.abs(y - start.y),
    };
    setBand(rect);
    // A plain click (no real movement) must not turn into a one-row selection.
    if (rect.width > 3 || rect.height > 3) {
      applyBand(rect);
    }
  };

  const stopBand = () => {
    bandStart.current = null;
    setBand(null);
    if (bandFrame.current !== 0) {
      window.cancelAnimationFrame(bandFrame.current);
      bandFrame.current = 0;
    }
  };

  const startBand = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }
    const target = event.target as HTMLElement;
    if (target.closest(".fm-row") !== null || target.closest(".fm-table__head") !== null) {
      return;
    }
    const body = bodyRef.current;
    if (body === null) {
      return;
    }
    const box = body.getBoundingClientRect();
    bandStart.current = {
      x: event.clientX - box.left,
      y: event.clientY - box.top + body.scrollTop,
      additive: event.ctrlKey || event.metaKey,
    };
    if (!bandStart.current.additive) {
      onSelectAll?.([]);
    }
    body.setPointerCapture(event.pointerId);
    setBand({ left: bandStart.current.x, top: bandStart.current.y, width: 0, height: 0 });
  };

  const moveBand = (event: React.PointerEvent<HTMLDivElement>) => {
    if (bandStart.current === null) {
      return;
    }
    updateBand(event.clientX, event.clientY);
    // Auto-scroll while the pointer is outside the body (Windows-like).
    const body = bodyRef.current;
    if (body === null || bandFrame.current !== 0) {
      return;
    }
    const box = body.getBoundingClientRect();
    const outside = event.clientY < box.top || event.clientY > box.bottom;
    if (!outside) {
      return;
    }
    const step = event.clientY < box.top ? -12 : 12;
    let lastY = event.clientY;
    const tick = () => {
      if (bandStart.current === null) {
        bandFrame.current = 0;
        return;
      }
      body.scrollTop += step;
      updateBand(event.clientX, lastY);
      bandFrame.current = window.requestAnimationFrame(tick);
    };
    bandFrame.current = window.requestAnimationFrame(tick);
  };

  const headerCheckRef = useRef<HTMLInputElement | null>(null);
  // A Set keeps select-all O(n) instead of O(n²) on folders with thousands of files.
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const allSelected = entries.length > 0 && entries.every((entry) => selectedSet.has(entry.name));
  const someSelected = !allSelected && entries.some((entry) => selectedSet.has(entry.name));

  useEffect(() => {
    if (headerCheckRef.current !== null) {
      headerCheckRef.current.indeterminate = someSelected;
    }
  }, [someSelected, allSelected]);

  const firstRow = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 6);
  const rowCount = Math.ceil(viewportHeight / ROW_HEIGHT) + 14;
  const windowed = entries.slice(firstRow, firstRow + rowCount);

  const head = (key: SortKey, label: string) => (
    <button
      type="button"
      className={`fm-table__sort${sort.key === key ? " fm-table__sort--active" : ""}`}
      style={{ textAlign: "left", justifyContent: "flex-start" }}
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
        <span className="fm-table__check">
          <input
            ref={headerCheckRef}
            type="checkbox"
            checked={allSelected}
            onChange={() => onSelectAll?.(allSelected ? [] : entries.map((entry) => entry.name))}
            aria-label={allSelected ? "取消全选" : "全选"}
            title={allSelected ? "取消全选" : "全选"}
          />
        </span>
        {head("name", "名称")}
        {head("size", "大小")}
        {showPermissions && head("type", "权限")}
        {head("mtime", "修改时间")}
      </div>
      {loading && <div className="fm-table__loadingbar" aria-hidden="true" />}
      <div
        className={`fm-table__body${band !== null ? " fm-table__body--banding" : ""}`}
        ref={bodyRef}
        onPointerDown={startBand}
        onPointerMove={moveBand}
        onPointerUp={stopBand}
        onPointerCancel={stopBand}
          onDragOver={(event) => {
            if (onDropEntries !== undefined) {
              event.preventDefault();
            }
          }}
          onDrop={(event) => {
            if (onDropEntries === undefined) {
              return;
            }
            const raw = event.dataTransfer.getData("application/x-leonssh-remote");
            if (raw.length === 0) {
              return;
            }
            event.preventDefault();
            try {
              onDropEntries(JSON.parse(raw) as FileEntry[]);
            } catch {
              // Ignore malformed payloads.
            }
          }}
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
        {band !== null && (
          <div
            className="fm-band"
            style={{
              left: band.left,
              top: band.top,
              width: band.width,
              height: band.height,
            }}
          />
        )}
        <div className="fm-table__spacer" style={{ height: entries.length * ROW_HEIGHT }}>
        {windowed.map((entry, index) => (
          <div
            key={entry.path}
            role="row"
            aria-selected={selectedSet.has(entry.name)}
            draggable={onRowDragStart !== undefined}
            onDragStart={(event) => onRowDragStart?.(entry, event)}
            style={{ position: "absolute", top: (firstRow + index) * ROW_HEIGHT, left: 0, right: 0 }}
            className={`fm-row${selectedSet.has(entry.name) ? " fm-row--selected" : ""}${
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
              if (!selectedSet.has(entry.name)) {
                onSelect(entry.name, "single");
              }
              onContextMenu(entry, event);
            }}
            onPointerDown={(event) =>
              onRowPointerDown?.(
                entry,
                event,
                entries.filter((item) => selected.includes(item.name)),
              )
            }
            title={entry.path}
          >
            <span className="fm-row__check">
              <input
                type="checkbox"
                checked={selectedSet.has(entry.name)}
                onChange={() => onSelect(entry.name, "toggle")}
                onClick={(event) => event.stopPropagation()}
                aria-label={`选择 ${entry.name}`}
              />
            </span>
            <span className={`fm-row__name${entry.isDir ? " fm-row__name--dir" : ""}`}>
              <ShellFileIcon name={entry.name} isDir={entry.isDir} isSymlink={entry.isSymlink} />
              {entry.name}
            </span>
            <span className="fm-row__size" style={{ textAlign: "left" }}>{entry.isDir ? "" : formatSize(entry.size)}</span>
            {showPermissions && (<span className="fm-row__mode" style={{ textAlign: "left" }}>{formatMode(entry.permissions)}</span>)}
            <span className="fm-row__time" style={{ textAlign: "left" }}>{formatTime(entry.mtimeMs)}</span>
          </div>
        ))}
        </div>
      </div>
    </div>
  );
}
