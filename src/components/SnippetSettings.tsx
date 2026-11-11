import { useEffect, useMemo, useState } from "react";

import { ConfirmDialog } from "./dialogs";
import { EyeIcon, EyeOffIcon } from "./icons";
import {
  clearSnippetOverride,
  deleteSnippet,
  loadSnippetCatalog,
  setSnippetOverride,
  type SnippetEntry,
} from "../lib/ipc/usage";

interface SnippetSettingsProps {
  enabled: boolean;
  onChangeEnabled: (enabled: boolean) => void;
}

/** Fuzzy match: case-insensitive substring, or an in-order subsequence. */
function matchesQuery(entry: SnippetEntry, query: string): boolean {
  if (query.length === 0) {
    return true;
  }
  const haystack = `${entry.template} ${entry.original}`.toLowerCase();
  if (haystack.includes(query)) {
    return true;
  }
  let index = 0;
  for (const char of haystack) {
    if (char === query[index]) {
      index += 1;
      if (index === query.length) {
        return true;
      }
    }
  }
  return false;
}

/** Settings → 配置参数: completion toggle + learned command snippets. */
export function SnippetSettings({ enabled, onChangeEnabled }: SnippetSettingsProps) {
  const [entries, setEntries] = useState<SnippetEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [pendingDelete, setPendingDelete] = useState<SnippetEntry | null>(null);
  const [error, setError] = useState("");

  const reload = () => {
    setLoading(true);
    void loadSnippetCatalog()
      .then((rows) => setEntries(rows))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    reload();
  }, []);

  const notifyTerminals = () => {
    window.dispatchEvent(new CustomEvent("leonssh:snippets-changed"));
  };

  const beginEdit = (entry: SnippetEntry) => {
    setError("");
    setEditing(entry.original);
    setDraft(entry.template);
  };

  const saveEdit = async (entry: SnippetEntry) => {
    const value = draft.trim();
    if (value.length === 0) {
      setError("命令内容不能为空");
      return;
    }
    try {
      await setSnippetOverride(entry.original, value, false);
      setEditing(null);
      reload();
      notifyTerminals();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  /** Hide = keep the row but stop suggesting it (reversible). */
  const setHidden = async (entry: SnippetEntry, hidden: boolean) => {
    try {
      await setSnippetOverride(entry.original, entry.template, hidden);
      reload();
      notifyTerminals();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  /** Delete = forget permanently (re-running the command may learn it again). */
  const confirmDelete = async (entry: SnippetEntry) => {
    setPendingDelete(null);
    try {
      await deleteSnippet(entry.original);
      reload();
      notifyTerminals();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const restore = async (entry: SnippetEntry) => {
    try {
      await clearSnippetOverride(entry.original);
      reload();
      notifyTerminals();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const normalizedQuery = query.trim().toLowerCase();
  const visible = useMemo(() => {
    const filtered = entries.filter((entry) => matchesQuery(entry, normalizedQuery));
    const list = showHidden ? filtered : filtered.filter((entry) => !entry.deleted);
    return [...list].sort((a, b) => {
      if (a.deleted !== b.deleted) {
        return a.deleted ? 1 : -1;
      }
      return b.count - a.count || a.template.localeCompare(b.template);
    });
  }, [entries, normalizedQuery, showHidden]);

  const visibleCount = entries.filter((entry) => !entry.deleted).length;
  const hiddenCount = entries.filter((entry) => entry.deleted).length;

  return (
    <div className="setting-group snippet-settings">
      <h3 className="setting-group__title">命令联想</h3>
      <label className="setting-toggle">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => onChangeEnabled(event.target.checked)}
        />
        <span>启用命令联想（命令名与常用组合命令）</span>
      </label>
      <p className="modal__hint">
        关闭后输入命令不会再弹出候选；已学习的组合命令仍会保留，重新开启即可继续使用。
      </p>

      <div className="snippet-settings__head">
        <span>已保存的组合命令（{visibleCount}）</span>
        <label className="snippet-settings__toggle">
          <input
            type="checkbox"
            checked={showHidden}
            onChange={(event) => setShowHidden(event.target.checked)}
          />
          <span>查看所有（含隐藏 {hiddenCount}）</span>
        </label>
      </div>

      <input
        className="input snippet-settings__search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="搜索命令（模糊匹配）…"
        aria-label="搜索组合命令"
      />

      {loading && <p className="modal__hint">正在读取…</p>}
      {!loading && entries.length === 0 && (
        <p className="modal__hint">
          还没有学习到组合命令。成功执行带参数或管道的命令（例如 <code>ls -la</code>）后会自动记录；执行失败的命令不会被记住。
        </p>
      )}
      {!loading && entries.length > 0 && visible.length === 0 && (
        <p className="modal__hint">没有匹配的组合命令。</p>
      )}

      {error.length > 0 && <p className="snippet-settings__error">{error}</p>}

      <ul className="snippet-list">
        {visible.map((entry) => {
          const isEditing = editing === entry.original;
          return (
            <li
              key={entry.original}
              className={`snippet-item${entry.deleted ? " snippet-item--hidden" : ""}`}
            >
              <button
                type="button"
                className={`snippet-item__eye${entry.deleted ? " snippet-item__eye--hidden" : ""}`}
                title={entry.deleted ? "重新显示此组合命令" : "隐藏此组合命令"}
                aria-label={entry.deleted ? "重新显示" : "隐藏"}
                onClick={() => void setHidden(entry, !entry.deleted)}
              >
                {entry.deleted ? <EyeIcon /> : <EyeOffIcon />}
              </button>

              <div className="snippet-item__main">
                {isEditing ? (
                  <input
                    className="input snippet-item__input"
                    value={draft}
                    autoFocus
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void saveEdit(entry);
                      } else if (event.key === "Escape") {
                        setEditing(null);
                      }
                    }}
                  />
                ) : (
                  <code className="snippet-item__text">{entry.template}</code>
                )}
                <span className="snippet-item__badge">使用 {entry.count} 次</span>
                {entry.edited && <span className="snippet-item__badge">已修改</span>}
                {entry.deleted && <span className="snippet-item__badge">已隐藏</span>}
              </div>

              <div className="snippet-item__actions">
                {isEditing ? (
                  <>
                    <button
                      type="button"
                      className="button button--primary button--sm"
                      onClick={() => void saveEdit(entry)}
                    >
                      保存
                    </button>
                    <button
                      type="button"
                      className="button button--ghost button--sm"
                      onClick={() => setEditing(null)}
                    >
                      取消
                    </button>
                  </>
                ) : (
                  <>
                    {!entry.deleted && (
                      <button
                        type="button"
                        className="button button--ghost button--sm"
                        onClick={() => beginEdit(entry)}
                      >
                        编辑
                      </button>
                    )}
                    {entry.edited && (
                      <button
                        type="button"
                        className="button button--ghost button--sm"
                        onClick={() => void restore(entry)}
                      >
                        恢复原始
                      </button>
                    )}
                    <button
                      type="button"
                      className="button button--ghost button--sm"
                      onClick={() => setPendingDelete(entry)}
                    >
                      删除
                    </button>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {pendingDelete !== null && (
        <ConfirmDialog
          title="删除组合命令"
          message={`确定删除「${pendingDelete.template}」吗？删除后如果再次成功执行同样的命令，仍可能被重新记录。`}
          confirmLabel="删除"
          onConfirm={() => void confirmDelete(pendingDelete)}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}
