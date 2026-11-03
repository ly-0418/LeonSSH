import type { TerminalStatus } from "../lib/ipc/types";
import { useTerminal } from "../hooks/useTerminal";
import type { ThemeMode } from "../lib/terminal/theme";

interface TerminalTabProps {
  sessionId: number;
  title: string;
  visible: boolean;
  theme: ThemeMode;
  fontSize: number;
  state: TerminalStatus["state"];
  onStatus: (patch: Partial<TerminalStatus>) => void;
  onReconnect?: () => void;
}

/**
 * One xterm instance per open tab. The component stays mounted while the tab
 * exists (hidden tabs only stop rendering), so switching tabs keeps scrollback.
 */
export function TerminalTab({
  sessionId,
  title,
  visible,
  theme,
  fontSize,
  state,
  onStatus,
  onReconnect,
}: TerminalTabProps) {
  const { containerRef, notice, clearNotice } = useTerminal({
    sessionId,
    title,
    visible,
    theme,
    fontSize,
    onStatus,
  });

  return (
    <section className="terminal-pane">

      <div className="terminal-host" ref={containerRef} />

      {state === "closed" && onReconnect !== undefined && (
        <button type="button" className="terminal-reconnect" onClick={onReconnect}>
          连接已断开，点击重新连接
        </button>
      )}

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
