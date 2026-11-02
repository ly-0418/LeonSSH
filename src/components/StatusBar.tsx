import type { AppInfo, SessionState, TerminalStatus } from "../lib/ipc/types";

const STATE_LABEL: Record<SessionState, string> = {
  connecting: "连接中",
  ready: "已就绪",
  closed: "已关闭",
  error: "错误",
};

const RENDERER_LABEL: Record<string, string> = {
  webgl: "WebGL2",
  dom: "DOM",
  pending: "检测中",
};

interface StatusBarProps {
  status: TerminalStatus;
  info: AppInfo | null;
}

export function StatusBar({ status, info }: StatusBarProps) {
  const fallback = info?.dataMode === "user-fallback";

  return (
    <footer className="status-bar">
      <span className={`chip chip--state chip--${status.state}`}>{STATE_LABEL[status.state]}</span>
      <span className="chip">渲染器 {RENDERER_LABEL[status.renderer] ?? status.renderer}</span>
      <span className="chip">
        PTY {status.cols || "—"}×{status.rows || "—"}
      </span>
      <span className="chip chip--muted">session {status.sessionId ?? "—"}</span>
      {status.endpoint !== undefined && (
        <span className="chip chip--host" title={`主机密钥指纹：${status.fingerprint ?? "—"}`}>
          {status.endpoint}
        </span>
      )}

      <span className="status-bar__spacer" />

      {info !== null && (
        <>
          <span className="chip chip--muted">活跃会话 {info.activeSessions}</span>
          <span
            className={`status-bar__path${fallback ? " status-bar__path--warn" : ""}`}
            title={`安装目录：${info.installDir}\n数据目录：${info.dataDir}\n日志目录：${info.logsDir}\n缓存目录：${info.cacheDir}`}
          >
            数据目录 {info.dataDir}
            {fallback ? "（安装目录不可写，已回退）" : ""}
          </span>
        </>
      )}
    </footer>
  );
}
