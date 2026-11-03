import type { TerminalStatus } from "../lib/ipc/types";
import { useTerminal } from "../hooks/useTerminal";
import type { ThemeMode } from "../lib/terminal/theme";

interface TerminalTabProps {
  sessionId: number;
  title: string;
  visible: boolean;
  /** Connection is authenticated and the shell is running. */
  connected: boolean;
  filesOpen: boolean;
  theme: ThemeMode;
  onToggleFiles: () => void;
  onStatus: (patch: Partial<TerminalStatus>) => void;
}

/**
 * One xterm instance per open tab. The component stays mounted while the tab
 * exists (hidden tabs only stop rendering), so switching tabs keeps scrollback.
 */
export function TerminalTab({
  sessionId,
  title,
  visible,
  connected,
  filesOpen,
  theme,
  onToggleFiles,
  onStatus,
}: TerminalTabProps) {
  const { containerRef, notice, clearNotice } = useTerminal({
    sessionId,
    title,
    visible,
    theme,
    onStatus,
  });

  return (
    <section className="terminal-pane">
      {/* Reserved action row: more per-session tools will land here later. */}
      <div className="session-toolbar">
        <button
          type="button"
          className={`session-toolbar__btn${filesOpen ? " session-toolbar__btn--active" : ""}`}
          disabled={!connected}
          title={connected ? "打开/关闭文件管理" : "连接成功后才能使用"}
          onClick={onToggleFiles}
        >
          文件管理
        </button>
        <span className="session-toolbar__spacer" />
      </div>

      <div className="terminal-host" ref={containerRef} />

      {notice !== null && (
        <button type="button" className="terminal-notice" onClick={clearNotice}>
          <span className="terminal-notice__dot" />
          {notice}
          <span className="terminal-notice__dismiss">点击关闭</span>
        </button>
      )}
    </section>
  );
}
