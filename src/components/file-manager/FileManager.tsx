import { LocalPane } from "./LocalPane";
import { RemotePane } from "./RemotePane";

interface FileManagerProps {
  terminalId: string | null;
  sessionTitle: string | null;
  onBackToTerminal: () => void;
}

/**
 * Dual-pane file manager view.
 *
 * Phase A: the local pane is fully functional, the remote pane is a placeholder
 * bound to the active terminal. Later phases fill in SFTP, transfers and the
 * CodeMirror editor without changing this layout.
 */
export function FileManager({ terminalId, sessionTitle, onBackToTerminal }: FileManagerProps) {
  // Optional deep link: `?view=files&local=C%3A%5CWindows` opens the pane there.
  const initialLocal = new URLSearchParams(window.location.search).get("local") ?? undefined;

  return (
    <div className="file-manager">
      <header className="fm-head">
        <span className="fm-head__title">文件管理</span>
        <span className="fm-head__hint">
          {terminalId === null
            ? "本地浏览可用；远程面板需要先在终端连接一个会话"
            : `已绑定：${sessionTitle ?? "当前会话"}`}
        </span>
        <button type="button" className="button button--ghost button--sm" onClick={onBackToTerminal}>
          返回终端
        </button>
      </header>

      <div className="fm-panes">
        <LocalPane initialPath={initialLocal} />
        <RemotePane terminalId={terminalId} sessionTitle={sessionTitle} />
      </div>
    </div>
  );
}
