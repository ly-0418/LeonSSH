import type { RefObject } from "react";

interface TerminalViewProps {
  containerRef: RefObject<HTMLDivElement | null>;
  notice: string | null;
  onDismissNotice: () => void;
}

/**
 * Presentational only: the xterm instance is owned by `useTerminal`, which
 * mounts it into the div rendered here.
 */
export function TerminalView({ containerRef, notice, onDismissNotice }: TerminalViewProps) {
  return (
    <section className="terminal-pane">
      <div className="terminal-host" ref={containerRef} />
      {notice !== null && (
        <button type="button" className="terminal-notice" onClick={onDismissNotice}>
          <span className="terminal-notice__dot" />
          {notice}
          <span className="terminal-notice__dismiss">点击关闭</span>
        </button>
      )}
    </section>
  );
}
