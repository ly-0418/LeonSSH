import { useEffect, useState } from "react";

interface PathBarProps {
  label: string;
  path: string;
  loading: boolean;
  roots?: string[];
  desktop?: string;
  search: string;
  onSearch: (value: string) => void;
  onNavigate: (path: string) => void;
  onUp: () => void;
  onRefresh: () => void;
}

export function PathBar({
  label,
  path,
  loading,
  roots,
  desktop,
  search,
  onSearch,
  onNavigate,
  onUp,
  onRefresh,
}: PathBarProps) {
  const [draft, setDraft] = useState(path);

  useEffect(() => {
    setDraft(path);
  }, [path]);

  function commit() {
    const next = draft.trim();
    if (next.length > 0 && next !== path) {
      onNavigate(next);
    }
  }

  return (
    <div className="fm-pathbar">
      <span className="fm-pathbar__label">{label}</span>
      <button type="button" className="fm-iconbtn" onClick={onUp} title="上一级" disabled={path === ""}>
        ↑
      </button>

      <div className="fm-pathbar__field">
        <input
          className="fm-pathbar__input"
          value={draft}
          spellCheck={false}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              commit();
            } else if (event.key === "Escape") {
              setDraft(path);
              event.currentTarget.blur();
            }
          }}
          onBlur={() => setDraft(path)}
          placeholder="输入路径后回车"
        />
        {roots !== undefined && roots.length > 0 && (
          <select
            className="fm-pathbar__roots"
            value=""
            onChange={(event) => {
              if (event.target.value) {
                onNavigate(event.target.value);
              }
            }}
            title="切换到其他盘符"
          >
            <option value="">盘符</option>
            {desktop !== undefined && <option value={desktop}>桌面</option>}
            {roots.map((root) => (
              <option key={root} value={root}>
                {root}
              </option>
            ))}
          </select>
        )}
      </div>

      <button type="button" className="fm-iconbtn" onClick={onRefresh} title="刷新" disabled={loading}>
        {loading ? "…" : "⟳"}
      </button>

      <input
        className="fm-pathbar__search"
        value={search}
        onChange={(event) => onSearch(event.target.value)}
        placeholder="搜索当前目录"
        spellCheck={false}
        title="按名称过滤当前目录"
      />
    </div>
  );
}
