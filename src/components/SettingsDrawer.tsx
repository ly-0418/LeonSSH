import { useEffect, useState } from "react";

import { forgetKnownHost, listKnownHosts } from "../lib/ipc/sessions";
import { toUserMessage } from "../lib/ipc/errors";
import type { KnownHostEntry } from "../lib/ipc/types";
import type { ThemeMode } from "../lib/terminal/theme";

interface SettingsDrawerProps {
  theme: ThemeMode;
  onChangeTheme: (theme: ThemeMode) => void;

  onClose: () => void;
}

type SettingsTab = "theme" | "hosts";

const TABS: Array<{ key: SettingsTab; label: string }> = [
  { key: "theme", label: "主题" },
  { key: "hosts", label: "主机" },
];

/** Right-side settings drawer: categories on the left, content on the right. */
export function SettingsDrawer({
  theme,
  onChangeTheme,

  onClose,
}: SettingsDrawerProps) {
  const [tab, setTab] = useState<SettingsTab>("theme");
  const [hosts, setHosts] = useState<KnownHostEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      <aside className="drawer" role="dialog" aria-modal="false" aria-label="设置">
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
