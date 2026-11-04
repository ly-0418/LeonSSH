/** React lifecycle wrapper around {@link TerminalSession}.
 *
 * This hook is the only place where a terminal is created or destroyed. One
 * instance is created per tab and kept mounted while the tab exists, so the
 * scrollback survives tab switches; visibility only affects fitting/focus.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import type { TerminalStatus } from "../lib/ipc/types";
import { TerminalSession } from "../lib/terminal/TerminalSession";
import type { ThemeMode } from "../lib/terminal/theme";

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
  theme: ThemeMode;
  fontSize: number;
  onInputLine?: (line: string) => void;
  onExecuted?: (line: string) => void;
  onStatus?: (patch: Partial<TerminalStatus>) => void;
}

export function useTerminal({
  sessionId,
  title,
  visible,
  theme,
  fontSize,
  onInputLine,
  onExecuted,
  onStatus,
}: UseTerminalOptions) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sessionRef = useRef<TerminalSession | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const statusRef = useRef(onStatus);
  statusRef.current = onStatus;
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const fontSizeRef = useRef(fontSize);
  const onInputLineRef = useRef(onInputLine);
  const onExecutedRef = useRef(onExecuted);
  onExecutedRef.current = onExecuted;
  onInputLineRef.current = onInputLine;
  fontSizeRef.current = fontSize;

  useEffect(() => {
    const container = containerRef.current;
    if (!container || sessionRef.current !== null) {
      return;
    }

    const session = new TerminalSession({
      container,
      sessionId,
      title,
      theme: themeRef.current,
      fontSize: fontSizeRef.current,
      onStatus: (patch) => statusRef.current?.(patch),
      onNotice: (message) => setNotice(message),
        onInputLine: (value) => onInputLineRef.current?.(value),
        onExecuted: (line) => onExecutedRef.current?.(line),
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

  useEffect(() => {
    sessionRef.current?.setTheme(theme);
  }, [theme]);

  useEffect(() => {
    sessionRef.current?.setFontSize(fontSize);
  }, [fontSize]);

  const clearNotice = useCallback(() => setNotice(null), []);
  const focus = useCallback(() => sessionRef.current?.focus(), []);

  const reconnect = useCallback(() => {
    void sessionRef.current?.reconnect();
  }, []);

  const cursorBox = useCallback(() => sessionRef.current?.getCursorBox() ?? null, []);

  const insertText = useCallback((text: string) => {
    void sessionRef.current?.insertText(text);
  }, []);

  const findNext = useCallback((text: string) => {
    sessionRef.current?.findNext(text);
  }, []);
  const findPrevious = useCallback((text: string) => {
    sessionRef.current?.findPrevious(text);
  }, []);

  return { containerRef, notice, clearNotice, reconnect, insertText, cursorBox, findNext, findPrevious, focus, initialStatus: INITIAL_STATUS };
}
