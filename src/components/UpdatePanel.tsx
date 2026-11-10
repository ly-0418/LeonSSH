import { useCallback, useEffect, useState } from "react";

import { appVersion, openExternalUrl } from "../lib/ipc/app";
import {
  checkForUpdate,
  fetchRecentReleases,
  releasesPageUrl,
  type ReleaseNote,
  type UpdateInfo,
} from "../lib/update";

type CheckState = "idle" | "checking" | "current" | "available" | "error";

const RECENT_LIMIT = 10;

function formatDate(value: string | null): string {
  if (value === null) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

/** Settings → 版本更新：当前版本、检查更新与最近版本的说明。 */
export function UpdatePanel() {
  const [version, setVersion] = useState("");
  const [state, setState] = useState<CheckState>("idle");
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [releases, setReleases] = useState<ReleaseNote[]>([]);
  const [releasesLoading, setReleasesLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    void appVersion()
      .then(setVersion)
      .catch(() => setVersion(""));
    setReleasesLoading(true);
    void fetchRecentReleases(RECENT_LIMIT).then((list) => {
      setReleases(list);
      setReleasesLoading(false);
      setExpanded((current) => current ?? list[0]?.version ?? null);
    });
  }, []);

  const check = useCallback(async () => {
    setState("checking");
    setUpdate(null);
    const current = version.length > 0 ? version : await appVersion().catch(() => "");
    if (current.length === 0) {
      setState("error");
      return;
    }
    if (version.length === 0) {
      setVersion(current);
    }
    const result = await checkForUpdate(current);
    if (result.kind === "update") {
      setUpdate(result.info);
      setState("available");
    } else {
      setState(result.kind);
    }
  }, [version]);

  const openUrl = (url: string) => {
    void openExternalUrl(url).catch(() => undefined);
  };

  return (
    <>
      <div className="setting-group update-panel">
        <h3 className="setting-group__title">版本更新</h3>
        <p className="modal__hint">
          当前版本 <strong>v{version.length > 0 ? version : "…"}</strong>
          ；更新包通过 GitHub Releases 分发，检查更新只读取版本号，不会自动下载。
        </p>

        <div className="update-panel__row">
          <button
            type="button"
            className="button button--primary button--sm"
            onClick={() => void check()}
            disabled={state === "checking"}
          >
            {state === "checking" ? "检查中…" : "检查更新"}
          </button>
          <button
            type="button"
            className="button button--ghost button--sm"
            onClick={() => openUrl(releasesPageUrl())}
          >
            打开发布页
          </button>
          <span className="update-panel__status">
            {state === "checking" && "正在连接 GitHub…"}
            {state === "current" && "已是最新版本"}
            {state === "error" && "检查失败，请稍后再试"}
            {state === "available" && `发现新版本 v${update?.version ?? ""}`}
          </span>
        </div>

        {update !== null && (
          <div className="update-panel__notes update-panel__notes--highlight">
            <div className="update-panel__row update-panel__row--tight">
              <strong>新版本 v{update.version}</strong>
              <button
                type="button"
                className="button button--primary button--sm"
                onClick={() => openUrl(update.url)}
              >
                前往下载
              </button>
            </div>
            <pre className="update-panel__body">{update.notes}</pre>
          </div>
        )}
      </div>

      <div className="setting-group">
        <h3 className="setting-group__title">最近 {RECENT_LIMIT} 个版本</h3>
        {releasesLoading && <p className="modal__hint">正在读取版本记录…</p>}
        {!releasesLoading && releases.length === 0 && (
          <p className="modal__hint">读取版本记录失败（可能无法访问 GitHub），可在设置外稍后重试。</p>
        )}
        <ul className="release-list">
          {releases.map((release) => {
            const isOpen = expanded === release.version;
            return (
              <li key={release.version} className={`release-item${isOpen ? " release-item--open" : ""}`}>
                <button
                  type="button"
                  className="release-item__head"
                  onClick={() => setExpanded(isOpen ? null : release.version)}
                  aria-expanded={isOpen}
                >
                  <span className="release-item__ver">v{release.version}</span>
                  <span className="release-item__title">{release.title}</span>
                  {release.version === version && <span className="release-item__badge">当前</span>}
                  {release.prerelease && <span className="release-item__badge">预发布</span>}
                  <span className="release-item__date">{formatDate(release.publishedAt)}</span>
                  <span className="release-item__chevron">{isOpen ? "▾" : "▸"}</span>
                </button>
                {isOpen && (
                  <div className="release-item__body">
                    <pre className="update-panel__body">{release.notes || "（该版本没有填写说明）"}</pre>
                    <button
                      type="button"
                      className="button button--ghost button--sm"
                      onClick={() => openUrl(release.url)}
                    >
                      在 GitHub 查看
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
}
