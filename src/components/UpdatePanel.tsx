import { useCallback, useEffect, useState } from "react";

import { appVersion, openExternalUrl } from "../lib/ipc/app";
import { checkForUpdate, releasesPageUrl, type UpdateInfo } from "../lib/update";

type CheckState = "idle" | "checking" | "current" | "available" | "error";

/** Settings → 配置参数：「版本与更新」区块，手动检查并跳转下载。 */
export function UpdatePanel() {
  const [version, setVersion] = useState("");
  const [state, setState] = useState<CheckState>("idle");
  const [update, setUpdate] = useState<UpdateInfo | null>(null);

  useEffect(() => {
    void appVersion()
      .then(setVersion)
      .catch(() => setVersion(""));
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

  const open = (url: string) => {
    void openExternalUrl(url).catch(() => undefined);
  };

  return (
    <div className="setting-group update-panel">
      <h3 className="setting-group__title">版本与更新</h3>
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
          onClick={() => open(releasesPageUrl())}
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
        <div className="update-panel__notes">
          <pre className="update-panel__body">{update.notes}</pre>
          <div className="update-panel__row">
            <button
              type="button"
              className="button button--primary button--sm"
              onClick={() => open(update.url)}
            >
              前往下载 v{update.version}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
