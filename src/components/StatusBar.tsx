import { useEffect, useState } from "react";

import { appVersion } from "../lib/ipc/app";
import type { TerminalStatus } from "../lib/ipc/types";

interface StatusBarProps {
  endpoint: string | null;
  sessionName: string | null;
  state: TerminalStatus["state"];
}

/** Minimal bottom bar: connection endpoint of the active session. */
export function StatusBar({ endpoint, sessionName, state }: StatusBarProps) {
  const [version, setVersion] = useState("");

  useEffect(() => {
    void appVersion()
      .then(setVersion)
      .catch(() => setVersion(""));
  }, []);

  return (
    <footer className="status-bar">
      <span className={`status-dot status-dot--${state}`} />
      <span className="status-bar__session">当前会话 → {sessionName ?? "未命名"}</span>
      <span className="status-bar__endpoint" title={endpoint ?? "未连接"}>
        {endpoint ?? "未连接"}
      </span>
      {version.length > 0 && <span className="status-bar__version">v{version}</span>}
    </footer>
  );
}
