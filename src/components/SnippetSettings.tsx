import { useEffect, useState } from "react";

import {
  clearSnippetOverride,
  loadSnippetCatalog,
  setSnippetOverride,
  type SnippetEntry,
} from "../lib/ipc/usage";

interface SnippetSettingsProps {
  enabled: boolean;
  onChangeEnabled: (enabled: boolean) => void;
}

/** Settings → 配置参数: completion toggle + learned command snippets. */
export function SnippetSettings({ enabled, onChangeEnabled }: SnippetSettingsProps) {
  const [entries, setEntries] = useState<SnippetEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDeleted, setShowDeleted] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
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

  const remove = async (entry: SnippetEntry) => {
    try {
      await setSnippetOverride(entry.original, entry.template, true);
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

  const visible = entries.filter((entry) => showDeleted || !entry.deleted);
  const deletedCount = entries.filter((entry) => entry.deleted).length;

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
        <span>已保存的组合命令（{visible.filter((entry) => !entry.deleted).length}）</span>
        <label className="snippet-settings__toggle">
          <input
            type="checkbox"
            checked={showDeleted}
            onChange={(event) => setShowDeleted(event.target.checked)}
          />
          <span>显示已删除（{deletedCount}）</span>
        </label>
      </div>

      {loading && <p className="modal__hint">正在读取…</p>}
      {!loading && visible.length === 0 && (
        <p className="modal__hint">
          还没有学习到组合命令。执行带参数或管道的命令（例如 <code>ls -la</code>）后会自动记录。
        </p>
      )}

      {error.length > 0 && <p className="snippet-settings__error">{error}</p>}

      <ul className="snippet-list">
        {visible.map((entry) => {
          const isEditing = editing === entry.original;
          return (
            <li
              key={entry.original}
              className={`snippet-item${entry.deleted ? " snippet-item--deleted" : ""}`}
            >
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
                {entry.deleted && <span className="snippet-item__badge">已删除</span>}
                {!entry.deleted && entry.edited && <span className="snippet-item__badge">已修改</span>}
                {entry.deleted && <span className="snippet-item__badge snippet-item__badge--dim">原：{entry.original}</span>}
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
                    {!entry.deleted && (
                      <button
                        type="button"
                        className="button button--ghost button--sm"
                        onClick={() => void remove(entry)}
                      >
                        删除
                      </button>
                    )}
                    {(entry.deleted || entry.edited) && (
                      <button
                        type="button"
                        className="button button--ghost button--sm"
                        onClick={() => void restore(entry)}
                      >
                        恢复原始
                      </button>
                    )}
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
