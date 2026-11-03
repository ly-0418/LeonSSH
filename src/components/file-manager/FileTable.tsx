import type { FileEntry } from "../../lib/fs/types";
import type { SelectionMode, SortKey, SortState } from "./useFilePane";
import { formatMode, formatSize, formatTime } from "./format";

interface FileTableProps {
  entries: FileEntry[];
  selected: string[];
  showPermissions?: boolean;
  loading: boolean;
  sort: SortState;
  onSort: (key: SortKey) => void;
  onSelect: (name: string, mode: SelectionMode) => void;
  onOpen: (entry: FileEntry) => void;
  /** `entry === null` means the empty area below the rows. */
  onContextMenu: (entry: FileEntry | null, event: React.MouseEvent) => void;
  onRowPointerDown?: (entry: FileEntry, event: React.PointerEvent) => void;
}

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
}: FileTableProps) {
  const arrow = (key: SortKey) => (sort.key === key ? (sort.dir === 1 ? " ▲" : " ▼") : "");

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
      <div
        className="fm-table__body"
        onContextMenu={(event) => {
          // Only fires when the click was not on a row (rows stop propagation).
          event.preventDefault();
          onContextMenu(null, event);
        }}
      >
        {entries.length === 0 && (
          <div className="fm-table__empty">{loading ? "加载中…" : "空目录（右键可新建）"}</div>
        )}
        {entries.map((entry) => (
          <div
            key={entry.path}
            role="row"
            aria-selected={selected.includes(entry.name)}
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
  );
}
