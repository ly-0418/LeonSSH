import { useEffect, useState } from "react";

import { appVersion } from "../lib/ipc/app";
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
  cursorStyle: "bar" | "underline";
  cursorWidth: number;
  onChangeCursorStyle: (style: "bar" | "underline", width: number) => void;

  onClose: () => void;
}

type SettingsTab = "theme" | "hosts" | "about";

const TABS: Array<{ key: SettingsTab; label: string }> = [
  { key: "theme", label: "界面样式" },
  { key: "hosts", label: "主机" },
  { key: "about", label: "关于" },
];

/** Right-side settings drawer: categories on the left, content on the right. */
export function SettingsDrawer({
  theme,
  onChangeTheme,
  exiting = false,
  fontSize,
  onChangeFontSize,
  cursorStyle,
  cursorWidth,
  onChangeCursorStyle,
  onClose,
}: SettingsDrawerProps) {
  const [tab, setTab] = useState<SettingsTab>("theme");
  const [hosts, setHosts] = useState<KnownHostEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState<string>("");

  useEffect(() => {
    void appVersion()
      .then(setVersion)
      .catch(() => setVersion(""));
  }, []);

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

  return (
    <div className="drawer-layer" role="presentation">
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

            {tab === "about" && (
              <div className="setting-group">
                <h3 className="setting-group__title">关于 LeonSSH</h3>
                <p className="modal__hint">
                  版本 {version.length > 0 ? `v${version}` : "…"} · Windows 优先的可视化 SSH 客户端
                </p>
                <ul className="about-list">
                  <li>数据目录：安装目录下的 <code>data</code>（数据库、日志、缓存、编辑临时文件）</li>
                  <li>密码与密钥口令：Windows 凭据管理器，不写入数据库</li>
                  <li>主机密钥：首次连接即记录指纹（TOFU），变更会提示</li>
                  <li>更新：当前版本需手动下载安装包覆盖；自动更新需要签名证书与发布源，尚未启用</li>
                </ul>
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
