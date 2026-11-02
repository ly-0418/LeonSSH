import type { TerminalStatus } from "../lib/ipc/types";
import { useTerminal } from "../hooks/useTerminal";

interface TerminalTabProps {
  sessionId: number;
  title: string;
  visible: boolean;
  onStatus: (patch: Partial<TerminalStatus>) => void;
}

/**
 * One xterm instance per open tab. The component stays mounted while the tab
 * exists (hidden tabs only stop rendering), so switching tabs keeps scrollback.
 */
export function TerminalTab({ sessionId, title, visible, onStatus }: TerminalTabProps) {
  const { containerRef, notice, clearNotice } = useTerminal({
    sessionId,
    title,
    visible,
    onStatus,
  });

  return (
    <section className="terminal-pane">
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
