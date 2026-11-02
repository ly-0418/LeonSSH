import type { FileEntry } from "../../lib/fs/types";
import type { SelectionMode } from "./useFilePane";
import { formatMode, formatSize, formatTime } from "./format";

interface FileTableProps {
  entries: FileEntry[];
  selected: string[];
  showPermissions?: boolean;
  loading: boolean;
  /** Rows can be dragged to the other pane (native HTML5 drag). */
  draggable?: boolean;
  onSelect: (name: string, mode: SelectionMode) => void;
  onOpen: (entry: FileEntry) => void;
}

export function FileTable({
  entries,
  selected,
  showPermissions = false,
  loading,
  draggable = false,
  onSelect,
  onOpen,
}: FileTableProps) {
  if (entries.length === 0) {
    return <div className="fm-table__empty">{loading ? "加载中…" : "空目录"}</div>;
  }

  return (
    <div className="fm-table" role="grid">
      <div className={`fm-table__head${showPermissions ? " fm-table__head--perm" : ""}`}>
        <span>名称</span>
        <span>大小</span>
        {showPermissions && <span>权限</span>}
        <span>修改时间</span>
      </div>
      <div className="fm-table__body">
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
            draggable={draggable}
            onDragStart={(event) => {
              if (!draggable) {
                return;
              }
              event.dataTransfer.setData("application/x-leonssh-path", entry.path);
              event.dataTransfer.setData("text/plain", entry.path);
              event.dataTransfer.effectAllowed = "copy";
            }}
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
