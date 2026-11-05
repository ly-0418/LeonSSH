import { useEffect, useRef, useState } from "react";

import { invoke } from "@tauri-apps/api/core";
import { FEATURE_DOCS } from "../lib/docs/featureDocs";
import { forgetKnownHost, listKnownHosts } from "../lib/ipc/sessions";
import { toUserMessage } from "../lib/ipc/errors";
import type { KnownHostEntry } from "../lib/ipc/types";
import type { ThemeMode } from "../lib/terminal/theme";

interface SettingsDrawerProps {
  theme: ThemeMode;
  onChangeTheme: (theme: ThemeMode) => void;
  /** Playing the slide-out animation; stays mounted until it ends. */
  exiting?: boolean;
  fontSize: number;
  onChangeFontSize: (size: number) => void;
  fontFamily: string;
  onChangeFontFamily: (family: string) => void;
  cursorStyle: "bar" | "underline";
  cursorWidth: number;
  onChangeCursorStyle: (style: "bar" | "underline", width: number) => void;

  showBroadcast: boolean;
  showForward: boolean;
  onChangeTabVisibility: (kind: "broadcast" | "forward", visible: boolean) => void;

  onClose: () => void;
}

type SettingsTab = "theme" | "config" | "logs" | "docs" | "hosts" | "about";

const TABS: Array<{ key: SettingsTab; label: string }> = [
  { key: "theme", label: "界面样式" },
  { key: "config", label: "配置参数" },
  { key: "hosts", label: "主机" },
  { key: "logs", label: "日志" },
  { key: "docs", label: "功能说明" },
];

/** Right-side settings drawer: categories on the left, content on the right. */
export function SettingsDrawer({
  theme,
  onChangeTheme,
  exiting = false,
  fontSize,
  onChangeFontSize,
  fontFamily,
  onChangeFontFamily,
  cursorStyle,
  cursorWidth,
  onChangeCursorStyle,
  showBroadcast,
  showForward,
  onChangeTabVisibility,
  onClose,
}: SettingsDrawerProps) {
  const [tab, setTab] = useState<SettingsTab>("theme");
  const [hosts, setHosts] = useState<KnownHostEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string>("");
  const [docQuery, setDocQuery] = useState("");
  const [logQuery, setLogQuery] = useState("");
  const [logHit, setLogHit] = useState(0);
  const [logsMaximized, setLogsMaximized] = useState(false);
  const logsRef = useRef<HTMLPreElement | null>(null);
  const hitRefs = useRef<Array<HTMLElement | null>>([]);

  useEffect(() => {
    if (tab !== "logs") {
      return;
    }
    let cancelled = false;
    const load = () => {
      void invoke<string>("logs_tail", { limit: 500 })
        .then((text) => {
          if (!cancelled) {
            setLogs(text);
          }
        })
        .catch((err) => {
          if (!cancelled) {
            setLogs(`读取日志失败：${String(err)}`);
          }
        })
        .finally(() => {
          if (!cancelled) {
          }
        });
    };
    load();
    const timer = window.setInterval(load, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [tab]);

  useEffect(() => {
    if (tab !== "hosts") {
      return;
    }
    let cancelled = false;
    listKnownHosts()
      .then((list) => {
        if (!cancelled) {
          setHosts(list);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(toUserMessage(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [tab]);

  async function forget(endpoint: string) {
    try {
      await forgetKnownHost(endpoint);
      setHosts((list) => (list === null ? list : list.filter((item) => item.endpoint !== endpoint)));
    } catch (err) {
      setError(toUserMessage(err));
    }
  }

  // Highlight matches (case-insensitive) and keep refs so Enter can jump.
  const highlightQuery = logQuery.trim().toLowerCase();
  const logNodes: React.ReactNode[] = [];
  let hitIndex = 0;
  logs.split("\n").forEach((line, lineIndex) => {
    const parts: React.ReactNode[] = [];
    if (highlightQuery.length === 0) {
      parts.push(line);
    } else {
      const lower = line.toLowerCase();
      let cursor = 0;
      let found = lower.indexOf(highlightQuery);
      while (found >= 0) {
        if (found > cursor) {
          parts.push(line.slice(cursor, found));
        }
        const index = hitIndex++;
        parts.push(
          <mark
            key={`hit-${index}`}
            className={`logs-hit${index === logHit ? " logs-hit--active" : ""}`}
            ref={(element) => {
              hitRefs.current[index] = element;
            }}
          >
            {line.slice(found, found + highlightQuery.length)}
          </mark>,
        );
        cursor = found + highlightQuery.length;
        found = lower.indexOf(highlightQuery, cursor);
      }
      parts.push(line.slice(cursor));
    }
    logNodes.push(
      <span key={`line-${lineIndex}`} className="logs-line">
        <span className="logs-line__no">{lineIndex + 1}</span>
        <span className="logs-line__text">{parts}</span>
      </span>,
    );
  });
  const logHitCount = highlightQuery.length === 0 ? 0 : hitIndex;

  useEffect(() => {
    if (highlightQuery.length === 0) {
      return;
    }
    hitRefs.current[logHit]?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [logHit, highlightQuery]);

  return (
    <div
      className="drawer-layer"
      role="presentation"
      onPointerDown={(event) => {
        // Clicking the dimmed area outside the panel closes the drawer.
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <aside className={`drawer${exiting ? " drawer--leave" : ""}`} role="dialog" aria-modal="false" aria-label="设置">
        <header className="drawer__head">
          <span className="drawer__title">设置</span>
          <button type="button" className="modal__close" onClick={onClose} aria-label="关闭设置">
            ✕
          </button>
        </header>

        <div className="drawer__body">
          <nav className="drawer__nav">
            {TABS.map((item) => (
              <button
                key={item.key}
                type="button"
                className={`drawer__navbtn${tab === item.key ? " drawer__navbtn--active" : ""}`}
                onClick={() => setTab(item.key)}
              >
                {item.label}
              </button>
            ))}
          </nav>

          <section className="drawer__content">
            {tab === "theme" && (
              <>
              <div className="setting-group">
                <h3 className="setting-group__title">主题</h3>
                <p className="modal__hint">同时作用于界面与终端配色。</p>
                <div className="theme-cards">
                  <button
                    type="button"
                    className={`theme-card${theme === "light" ? " theme-card--active" : ""}`}
                    onClick={() => onChangeTheme("light")}
                  >
                    <span className="theme-card__icon">☀</span>
                    亮色
                  </button>
                  <button
                    type="button"
                    className={`theme-card${theme === "dark" ? " theme-card--active" : ""}`}
                    onClick={() => onChangeTheme("dark")}
                  >
                    <span className="theme-card__icon">☾</span>
                    暗色
                  </button>
                </div>
              </div>

              <div className="setting-group">
                <h3 className="setting-group__title">终端字号</h3>
                <p className="modal__hint">
                  只调整终端内的文字大小，界面布局保持不变。
                </p>
                <div className="font-size-row">
                  <input
                    type="range"
                    min={11}
                    max={20}
                    step={1}
                    value={fontSize}
                    onChange={(event) => onChangeFontSize(Number.parseInt(event.target.value, 10))}
                  />
                  <span className="font-size-value">{fontSize} px</span>
                </div>
              </div>
              <div className="setting-group">
                <h3 className="setting-group__title">终端字体</h3>
                <p className="modal__hint">选择终端使用的等宽字体。</p>
                <select
                  className="input font-family-select"
                  value={fontFamily}
                  onChange={(event) => onChangeFontFamily(event.target.value)}
                >
                  <option value="Cascadia Mono, Consolas, monospace">Cascadia Mono（Windows 默认）</option>
                  <option value="Consolas, monospace">Consolas</option>
                  <option value="'JetBrains Mono', Consolas, monospace">JetBrains Mono</option>
                  <option value="'Fira Code', Consolas, monospace">Fira Code</option>
                  <option value="'Source Code Pro', Consolas, monospace">Source Code Pro</option>
                  <option value="'Courier New', monospace">Courier New</option>
                  <option value="monospace">系统等宽</option>
                </select>
              </div>

              <div className="setting-group">
                <h3 className="setting-group__title">终端光标</h3>
                <p className="modal__hint">选择光标形状；竖线可以调整粗细。</p>
                <div className="cursor-options">
                  <button
                    type="button"
                    className={`cursor-option${cursorStyle === "bar" ? " cursor-option--active" : ""}`}
                    onClick={() => onChangeCursorStyle("bar", cursorWidth)}
                  >
                    <span className="cursor-option__preview">
                      <span className="cursor-option__bar" style={{ width: `${cursorWidth}px` }} />
                    </span>
                    竖线
                  </button>
                  <button
                    type="button"
                    className={`cursor-option${cursorStyle === "underline" ? " cursor-option--active" : ""}`}
                    onClick={() => onChangeCursorStyle("underline", cursorWidth)}
                  >
                    <span className="cursor-option__preview">
                      <span className="cursor-option__underline" />
                    </span>
                    横线
                  </button>
                </div>
                {cursorStyle === "bar" && (
                  <div className="font-size-row">
                    <input
                      type="range"
                      min={1}
                      max={6}
                      step={1}
                      value={cursorWidth}
                      onChange={(event) =>
                        onChangeCursorStyle("bar", Number.parseInt(event.target.value, 10))
                      }
                    />
                    <span className="font-size-value">{cursorWidth} px</span>
                  </div>
                )}
                <div className="cursor-preview">
                  <span className="cursor-preview__prompt">root@leonssh:~$</span>
                  <span
                    className={
                      cursorStyle === "bar"
                        ? "cursor-preview__caret"
                        : "cursor-preview__caret cursor-preview__caret--line"
                    }
                    style={cursorStyle === "bar" ? { width: `${cursorWidth}px` } : undefined}
                  />
                </div>
              </div>

              </>
            )}

            {tab === "config" && (
              <div className="setting-group">
                <h3 className="setting-group__title">标签栏按钮</h3>
                <p className="modal__hint">
                  控制标签栏右侧按钮的显示。关闭后仍可从连接菜单使用对应能力。
                </p>
                <label className="setting-toggle">
                  <input
                    type="checkbox"
                    checked={showBroadcast}
                    onChange={(event) => onChangeTabVisibility("broadcast", event.target.checked)}
                  />
                  显示「广播」按钮
                </label>
                <label className="setting-toggle">
                  <input
                    type="checkbox"
                    checked={showForward}
                    onChange={(event) => onChangeTabVisibility("forward", event.target.checked)}
                  />
                  显示「转发」按钮
                </label>
              </div>
            )}

            {tab === "logs" && (
              <div className={`logs-panel${logsMaximized ? " logs-panel--max" : ""}`}>
                <div className="logs-search">
                  <input
                    className="input"
                    value={logQuery}
                    onChange={(event) => {
                      setLogQuery(event.target.value);
                      setLogHit(0);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        if (logHitCount > 0) {
                          setLogHit((current) =>
                            event.shiftKey
                              ? (current - 1 + logHitCount) % logHitCount
                              : (current + 1) % logHitCount,
                          );
                        }
                      }
                    }}
                    placeholder="搜索日志…（Enter 下一个，Shift+Enter 上一个）"
                  />
                  <span className="logs-search__count">
                    {logQuery.trim().length > 0 ? `${logHitCount === 0 ? 0 : logHit + 1}/${logHitCount}` : ""}
                  </span>
                  <button
                    type="button"
                    className="logs-zoom"
                    title={logsMaximized ? "还原日志窗口" : "放大日志窗口"}
                    onClick={() => setLogsMaximized((value) => !value)}
                  >
                    {logsMaximized ? "🗗" : "⛶"}
                  </button>
                </div>
                <pre className="logs-view" ref={logsRef}>
                  {logNodes}
                </pre>
              </div>
            )}

            {tab === "docs" && (
              <div className="setting-group">
                <h3 className="setting-group__title">功能说明</h3>
                <input
                  className="input"
                  value={docQuery}
                  onChange={(event) => {
                    const value = event.target.value;
                    setDocQuery(value);
                    if (value.trim().length === 0) {
                      return;
                    }
                    window.setTimeout(() => {
                      document
                        .querySelector(".docs-section--match")
                        ?.scrollIntoView({ block: "start", behavior: "smooth" });
                    }, 30);
                  }}
                  placeholder="搜索功能关键词，例如：拖拽、转发、日志"
                />
                {FEATURE_DOCS.filter((section) => {
                  const query = docQuery.trim().toLowerCase();
                  if (query.length === 0) {
                    return true;
                  }
                  return (section.title + section.body.join(" ")).toLowerCase().includes(query);
                }).map((section) => (
                  <section key={section.id} className="docs-section docs-section--match">
                    <h4 className="docs-section__title">{section.title}</h4>
                    <ul className="docs-section__list">
                      {section.body.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            )}

            {tab === "hosts" && (
              <div className="setting-group">
                <h3 className="setting-group__title">已知主机（TOFU 指纹）</h3>
                <p className="modal__hint">
                  首次连接时记录的服务器指纹。删除后下次连接会重新记录，请确认服务器确实重装过。
                </p>
                {error !== null && <p className="form-error">{error}</p>}
                {hosts === null && <p className="modal__hint">加载中…</p>}
                {hosts !== null && hosts.length === 0 && (
                  <p className="modal__hint">还没有记录任何主机。</p>
                )}
                <ul className="host-list">
                  {(hosts ?? []).map((entry) => (
                    <li key={entry.endpoint} className="host-item">
                      <span className="host-item__endpoint">{entry.endpoint}</span>
                      <span className="host-item__fp" title={entry.fingerprint}>
                        {entry.fingerprint}
                      </span>
                      <button
                        type="button"
                        className="button button--ghost button--sm"
                        onClick={() => void forget(entry.endpoint)}
                      >
                        删除
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}


          </section>
        </div>
      </aside>
    </div>
  );
}
