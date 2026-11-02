/** React lifecycle wrapper around {@link TerminalSession}.
 *
 * This hook is the only place where a terminal is created or destroyed. One
 * instance is created per tab and kept mounted while the tab exists, so the
 * scrollback survives tab switches; visibility only affects fitting/focus.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import type { TerminalStatus } from "../lib/ipc/types";
import { TerminalSession } from "../lib/terminal/TerminalSession";

const INITIAL_STATUS: TerminalStatus = {
  terminalId: null,
  renderer: "pending",
  cols: 0,
  rows: 0,
  state: "connecting",
};

export interface UseTerminalOptions {
  sessionId: number;
  title: string;
  visible: boolean;
  onStatus?: (patch: Partial<TerminalStatus>) => void;
}

export function useTerminal({ sessionId, title, visible, onStatus }: UseTerminalOptions) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sessionRef = useRef<TerminalSession | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const statusRef = useRef(onStatus);
  statusRef.current = onStatus;

  useEffect(() => {
    const container = containerRef.current;
    if (!container || sessionRef.current !== null) {
      return;
    }

    const session = new TerminalSession({
      container,
      sessionId,
      title,
      onStatus: (patch) => statusRef.current?.(patch),
      onNotice: (message) => setNotice(message),
    });
    sessionRef.current = session;

    return () => {
      sessionRef.current = null;
      void session.dispose();
    };
  }, [sessionId, title]);

  useEffect(() => {
    sessionRef.current?.setVisible(visible);
  }, [visible]);

  const clearNotice = useCallback(() => setNotice(null), []);
  const focus = useCallback(() => sessionRef.current?.focus(), []);

  return { containerRef, notice, clearNotice, focus, initialStatus: INITIAL_STATUS };
}
