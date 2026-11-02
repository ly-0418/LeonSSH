/** React lifecycle wrapper around {@link TerminalSession}.
 *
 * This hook is the only place where a terminal is created or destroyed. The
 * session is created in an effect (so the container ref is already attached)
 * and always disposed on unmount — including React 19's development
 * double-invoke, which is why creation is ref-guarded and disposal is async.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import type { TerminalStatus } from "../lib/ipc/types";
import { TerminalSession } from "../lib/terminal/TerminalSession";

const INITIAL_STATUS: TerminalStatus = {
  sessionId: null,
  renderer: "pending",
  cols: 0,
  rows: 0,
  state: "connecting",
};

export function useTerminal(title?: string) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sessionRef = useRef<TerminalSession | null>(null);
  const [status, setStatus] = useState<TerminalStatus>(INITIAL_STATUS);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || sessionRef.current !== null) {
      return;
    }

    const session = new TerminalSession({
      container,
      title,
      onStatus: (patch) => setStatus((previous) => ({ ...previous, ...patch })),
      onNotice: (message) => setNotice(message),
    });
    sessionRef.current = session;

    return () => {
      sessionRef.current = null;
      void session.dispose();
    };
  }, [title]);

  const clearNotice = useCallback(() => setNotice(null), []);
  const focus = useCallback(() => sessionRef.current?.focus(), []);

  return { containerRef, status, notice, clearNotice, focus };
}
