import { useEffect, useState } from "react";

import { StatusBar } from "./components/StatusBar";
import { TerminalView } from "./components/TerminalView";
import { useTerminal } from "./hooks/useTerminal";
import { toUserMessage } from "./lib/ipc/errors";
import { fetchAppInfo } from "./lib/ipc/session";
import type { AppInfo } from "./lib/ipc/types";

const SESSION_TITLE = "阶段 1 · 字节流通路";

export default function App() {
  const { containerRef, status, notice, clearNotice } = useTerminal(SESSION_TITLE);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchAppInfo()
      .then((value) => {
        if (!cancelled) {
          setInfo(value);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setBootError(toUserMessage(error));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="brand__mark">▌</span>
          <h1 className="brand__title">LeonSSH</h1>
          <span className="brand__subtitle">阶段 1 · 字节流通路骨架</span>
        </div>
        <div className="app-header__meta">
          <span>{info !== null ? `v${info.version}` : "v—"}</span>
          <span className="app-header__sep" />
          <span>{info !== null ? `${info.platform}/${info.arch}` : "—"}</span>
        </div>
      </header>

      {bootError !== null && <div className="boot-error">{bootError}</div>}

      <TerminalView containerRef={containerRef} notice={notice} onDismissNotice={clearNotice} />

      <StatusBar status={status} info={info} />
    </div>
  );
}
