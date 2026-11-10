import { useEffect, useState } from "react";

import { appVersion, openExternalUrl } from "../lib/ipc/app";
import { subscribeAvailableUpdate } from "../lib/updateStore";
import type { UpdateInfo } from "../lib/update";
import { UpdateAvailableIcon } from "./icons";
import type { TerminalStatus } from "../lib/ipc/types";

interface StatusBarProps {
  endpoint: string | null;
  sessionName: string | null;
  state: TerminalStatus["state"];
}

/** Minimal bottom bar: connection endpoint, update badge and app version. */
export function StatusBar({ endpoint, sessionName, state }: StatusBarProps) {
  const [version, setVersion] = useState("");
  const [update, setUpdate] = useState<UpdateInfo | null>(null);

  useEffect(() => {
    void appVersion()
      .then(setVersion)
      .catch(() => setVersion(""));
    return subscribeAvailableUpdate(setUpdate);
  }, []);

  return (
    <footer className="status-bar">
      <span className={`status-dot status-dot--${state}`} />
      <span className="status-bar__session">当前会话 → {sessionName ?? "未命名"}</span>
      <span className="status-bar__endpoint" title={endpoint ?? "未连接"}>
        {endpoint ?? "未连接"}
      </span>
      <span className="status-bar__right">
        {update !== null && (
          <button
            type="button"
            className="status-bar__update"
            title={`发现新版本 v${update.version}，点击前往下载`}
            aria-label={`发现新版本 v${update.version}`}
            onClick={() => {
              void openExternalUrl(update.url).catch(() => undefined);
            }}
          >
            <UpdateAvailableIcon size={22} />
          </button>
        )}
        {version.length > 0 && <span className="status-bar__version">v{version}</span>}
      </span>
    </footer>
  );
}
